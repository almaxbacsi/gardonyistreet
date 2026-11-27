// Contact-hardening soft shadows (PCSS-style) for the sun.
// Replaces three.js' BasicShadowMap lookup (which samples raw depth) with:
//   1) blocker search on a Vogel disk  ->  average blocker depth
//   2) penumbra width from blocker distance (wider the farther the caster)
//   3) Vogel-disk filtering with a per-pixel rotation (interleaved gradient noise)
// plus a receiver-plane depth bias so sloped ground (the street climbs ~25 %) doesn't self-shadow.
import * as THREE from 'three';

let original = null;

/**
 * @param {{width:number,height:number,depth:number}} frustum shadow camera size in metres
 * @param {{search:number,taps:number,sun:number,maxPenumbra:number}} q quality settings
 */
export function installSoftShadows(frustum, q = {}) {
  const search = q.search ?? 8, taps = q.taps ?? 16;
  const sun = q.sun ?? 0.022; // penumbra metres per metre of blocker distance
  const maxPen = q.maxPenumbra ?? 0.55;
  const chunk = (original ??= THREE.ShaderChunk.shadowmap_pars_fragment);
  // the BASIC variant is the sampler2D getShadow that reads raw depth (comments are stripped in the build)
  const i0 = chunk.indexOf('float depth = texture2D( shadowMap, shadowCoord.xy ).r;');
  const f0 = chunk.lastIndexOf('float getShadow( sampler2D shadowMap', i0);
  const ret = chunk.indexOf('return mix( 1.0, shadow, shadowIntensity );', i0);
  const f1 = chunk.indexOf('}', ret) + 1;
  if (i0 < 0 || f0 < 0 || ret < 0) {
    console.warn('[softShadows] unexpected shader chunk layout – keeping stock shadows');
    return false;
  }
  const fn = /* glsl */`
		const vec2 GS_FRUSTUM = vec2( ${frustum.width.toFixed(3)}, ${frustum.height.toFixed(3)} );
		const float GS_DEPTH = ${frustum.depth.toFixed(3)};
		float gsIGN( vec2 p ) { return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) ); }
		vec2 gsVogel( int i, int n, float phi ) {
			float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
			float th = float( i ) * 2.39996323 + phi;
			return r * vec2( cos( th ), sin( th ) );
		}
		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			shadowCoord.xyz /= shadowCoord.w;
			vec3 sc = shadowCoord.xyz;
			vec3 dx = dFdx( sc ), dy = dFdy( sc );
			if ( !( sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0 && sc.z <= 1.0 ) ) return 1.0;
			// receiver plane depth gradient in shadow-map uv space
			float det = dx.x * dy.y - dx.y * dy.x;
			vec2 dz = vec2( 0.0 );
			if ( abs( det ) > 1e-12 ) dz = vec2( dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z ) / det;
			vec2 texel = 1.0 / shadowMapSize;
			float maxSlope = 0.0025 / max( texel.x, texel.y );
			dz = clamp( dz, vec2( -maxSlope ), vec2( maxSlope ) );
			float zr = sc.z + shadowBias - ( abs( dz.x ) * texel.x + abs( dz.y ) * texel.y ) * 0.4;
			float phi = gsIGN( gl_FragCoord.xy ) * 6.2831853;
			// 1) blocker search
			vec2 searchR = vec2( ${(maxPen * 0.9).toFixed(3)} ) / GS_FRUSTUM;
			float blk = 0.0, nb = 0.0;
			for ( int i = 0; i < ${search}; i ++ ) {
				vec2 o = gsVogel( i, ${search}, phi ) * searchR;
				float d = texture2D( shadowMap, sc.xy + o ).r;
				if ( d < zr + dot( o, dz ) ) { blk += d; nb += 1.0; }
			}
			if ( nb < 0.5 ) return 1.0;
			// 2) penumbra estimate
			float distM = max( zr - blk / nb, 0.0 ) * GS_DEPTH;
			float penM = clamp( distM * ${sun.toFixed(4)} * shadowRadius, 0.015, ${maxPen.toFixed(3)} );
			vec2 filtR = max( vec2( penM ) / GS_FRUSTUM, texel * 1.25 );
			// 3) filter
			float lit = 0.0;
			for ( int i = 0; i < ${taps}; i ++ ) {
				vec2 o = gsVogel( i, ${taps}, phi + 1.7 ) * filtR;
				float d = texture2D( shadowMap, sc.xy + o ).r;
				lit += step( zr + dot( o, dz ), d );
			}
			lit /= float( ${taps} );
			// fade out at the map border so the frustum edge never shows
			vec2 e = min( sc.xy, 1.0 - sc.xy );
			lit = mix( 1.0, lit, smoothstep( 0.0, 0.03, min( e.x, e.y ) ) );
			return mix( 1.0, lit, shadowIntensity );
		}`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, f0) + fn + chunk.slice(f1);
  return true;
}
