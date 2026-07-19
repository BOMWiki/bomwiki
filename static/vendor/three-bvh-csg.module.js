import { BufferAttribute, Vector3, Ray, Vector2, Vector4, Mesh, Matrix4, Line3, Plane, Triangle, DoubleSide, Matrix3, BufferGeometry, Group, Color, MeshPhongMaterial, MathUtils, LineSegments, LineBasicMaterial, InstancedMesh, SphereGeometry, MeshBasicMaterial } from './three.module.min.js';
import { MeshBVH, ExtendedTriangle } from './three-mesh-bvh.module.js';

const HASH_WIDTH = 1e-6;
const HASH_HALF_WIDTH = HASH_WIDTH * 0.5;
const HASH_MULTIPLIER = Math.pow( 10, - Math.log10( HASH_WIDTH ) );
const HASH_ADDITION = HASH_HALF_WIDTH * HASH_MULTIPLIER;
function hashNumber( v ) {

	return ~ ~ ( v * HASH_MULTIPLIER + HASH_ADDITION );

}

function hashVertex2( v ) {

	return `${ hashNumber( v.x ) },${ hashNumber( v.y ) }`;

}

function hashVertex3( v ) {

	return `${ hashNumber( v.x ) },${ hashNumber( v.y ) },${ hashNumber( v.z ) }`;

}

function hashVertex4( v ) {

	return `${ hashNumber( v.x ) },${ hashNumber( v.y ) },${ hashNumber( v.z ) },${ hashNumber( v.w ) }`;

}

function hashRay( r ) {

	return `${ hashVertex3( r.origin ) }-${ hashVertex3( r.direction ) }`;

}

function toNormalizedRay( v0, v1, target ) {

	// get a normalized direction
	target
		.direction
		.subVectors( v1, v0 )
		.normalize();

	// project the origin onto the perpendicular plane that
	// passes through 0, 0, 0
	const scalar = v0.dot( target.direction );
	target.
		origin
		.copy( v0 )
		.addScaledVector( target.direction, - scalar );

	return target;

}

function areSharedArrayBuffersSupported() {

	return typeof SharedArrayBuffer !== 'undefined';

}

function convertToSharedArrayBuffer( array ) {

	if ( array.buffer instanceof SharedArrayBuffer ) {

		return array;

	}

	const cons = array.constructor;
	const buffer = array.buffer;
	const sharedBuffer = new SharedArrayBuffer( buffer.byteLength );

	const uintArray = new Uint8Array( buffer );
	const sharedUintArray = new Uint8Array( sharedBuffer );
	sharedUintArray.set( uintArray, 0 );

	return new cons( sharedBuffer );

}

function getIndexArray( vertexCount, BufferConstructor = ArrayBuffer ) {

	if ( vertexCount > 65535 ) {

		return new Uint32Array( new BufferConstructor( 4 * vertexCount ) );

	} else {

		return new Uint16Array( new BufferConstructor( 2 * vertexCount ) );

	}

}

function ensureIndex( geo, options ) {

	if ( ! geo.index ) {

		const vertexCount = geo.attributes.position.count;
		const BufferConstructor = options.useSharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer;
		const index = getIndexArray( vertexCount, BufferConstructor );
		geo.setIndex( new BufferAttribute( index, 1 ) );

		for ( let i = 0; i < vertexCount; i ++ ) {

			index[ i ] = i;

		}

	}

}

function getVertexCount( geo ) {

	return geo.index ? geo.index.count : geo.attributes.position.count;

}

function getTriCount( geo ) {

	return getVertexCount( geo ) / 3;

}

const DEGENERATE_EPSILON = 1e-8;
const _tempVec = new Vector3();

function toTriIndex( v ) {

	return ~ ~ ( v / 3 );

}

function toEdgeIndex( v ) {

	return v % 3;

}

function sortEdgeFunc( a, b ) {

	return a.start - b.start;

}

function getProjectedDistance( ray, vec ) {

	return _tempVec.subVectors( vec, ray.origin ).dot( ray.direction );

}

function hasOverlaps( arr ) {

	arr = [ ...arr ].sort( sortEdgeFunc );
	for ( let i = 0, l = arr.length; i < l - 1; i ++ ) {

		const info0 = arr[ i ];
		const info1 = arr[ i + 1 ];

		if ( info1.start < info0.end && Math.abs( info1.start - info0.end ) > 1e-5 ) {

			return true;

		}

	}

	return false;

}

function getEdgeSetLength( arr ) {

	let tot = 0;
	arr.forEach( ( { start, end } ) => tot += end - start );
	return tot;

}

function matchEdges( forward, reverse, disjointConnectivityMap, eps = DEGENERATE_EPSILON ) {

	forward.sort( sortEdgeFunc );
	reverse.sort( sortEdgeFunc );

	for ( let i = 0; i < forward.length; i ++ ) {

		const e0 = forward[ i ];
		for ( let o = 0; o < reverse.length; o ++ ) {

			const e1 = reverse[ o ];
			if ( e1.start > e0.end ) {

				// e2 is completely after e1
				// break;

				// NOTE: there are cases where there are overlaps due to precision issues or
				// thin / degenerate triangles. Assuming the sibling side has the same issues
				// we let the matching work here. Long term we should remove the degenerate
				// triangles before this.

			} else if ( e0.end < e1.start || e1.end < e0.start ) {

				// e1 is completely before e2
				continue;

			} else if ( e0.start <= e1.start && e0.end >= e1.end ) {

				// e1 is larger than and e2 is completely within e1
				if ( ! areDistancesDegenerate( e1.end, e0.end ) ) {

					forward.splice( i + 1, 0, {
						start: e1.end,
						end: e0.end,
						index: e0.index,
					} );

				}

				e0.end = e1.start;

				e1.start = 0;
				e1.end = 0;

			} else if ( e0.start >= e1.start && e0.end <= e1.end ) {

				// e2 is larger than and e1 is completely within e2
				if ( ! areDistancesDegenerate( e0.end, e1.end ) ) {

					reverse.splice( o + 1, 0, {
						start: e0.end,
						end: e1.end,
						index: e1.index,
					} );

				}

				e1.end = e0.start;

				e0.start = 0;
				e0.end = 0;

			} else if ( e0.start <= e1.start && e0.end <= e1.end ) {

				// e1 overlaps e2 at the beginning
				const tmp = e0.end;
				e0.end = e1.start;
				e1.start = tmp;

			} else if ( e0.start >= e1.start && e0.end >= e1.end ) {

				// e1 overlaps e2 at the end
				const tmp = e1.end;
				e1.end = e0.start;
				e0.start = tmp;

			} else {

				throw new Error();

			}

			// Add the connectivity information
			if ( ! disjointConnectivityMap.has( e0.index ) ) {

				disjointConnectivityMap.set( e0.index, [] );

			}

			if ( ! disjointConnectivityMap.has( e1.index ) ) {

				disjointConnectivityMap.set( e1.index, [] );

			}

			disjointConnectivityMap
				.get( e0.index )
				.push( e1.index );

			disjointConnectivityMap
				.get( e1.index )
				.push( e0.index );

			if ( isEdgeDegenerate( e1 ) ) {

				reverse.splice( o, 1 );
				o --;

			}

			if ( isEdgeDegenerate( e0 ) ) {

				// and if we have to remove the current original edge then exit this loop
				// so we can work on the next one
				forward.splice( i, 1 );
				i --;
				break;

			}

		}

	}

	cleanUpEdgeSet( forward );
	cleanUpEdgeSet( reverse );

	function cleanUpEdgeSet( arr ) {

		for ( let i = 0; i < arr.length; i ++ ) {

			if ( isEdgeDegenerate( arr[ i ] ) ) {

				arr.splice( i, 1 );
				i --;

			}

		}

	}

	function areDistancesDegenerate( start, end ) {

		return Math.abs( end - start ) < eps;

	}

	function isEdgeDegenerate( e ) {

		return Math.abs( e.end - e.start ) < eps;

	}

}

const DIST_EPSILON = 1e-5;
const ANGLE_EPSILON = 1e-4;

class RaySet {

	constructor() {

		this._rays = [];

	}

	addRay( ray ) {

		this._rays.push( ray );

	}

	findClosestRay( ray ) {

		const rays = this._rays;
		const inv = ray.clone();
		inv.direction.multiplyScalar( - 1 );

		let bestScore = Infinity;
		let bestRay = null;
		for ( let i = 0, l = rays.length; i < l; i ++ ) {

			const r = rays[ i ];
			if ( skipRay( r, ray ) && skipRay( r, inv ) ) {

				continue;

			}

			const rayScore = scoreRays( r, ray );
			const invScore = scoreRays( r, inv );
			const score = Math.min( rayScore, invScore );
			if ( score < bestScore ) {

				bestScore = score;
				bestRay = r;

			}

		}

		return bestRay;

		function skipRay( r0, r1 ) {

			const distOutOfThreshold = r0.origin.distanceTo( r1.origin ) > DIST_EPSILON;
			const angleOutOfThreshold = r0.direction.angleTo( r1.direction ) > ANGLE_EPSILON;
			return angleOutOfThreshold || distOutOfThreshold;

		}

		function scoreRays( r0, r1 ) {

			const originDistance = r0.origin.distanceTo( r1.origin );
			const angleDistance = r0.direction.angleTo( r1.direction );
			return originDistance / DIST_EPSILON + angleDistance / ANGLE_EPSILON;

		}

	}

}

const _v0 = new Vector3();
const _v1 = new Vector3();
const _ray$2 = new Ray();

function computeDisjointEdges(
	geometry,
	unmatchedSet,
	eps,
) {

	const attributes = geometry.attributes;
	const indexAttr = geometry.index;
	const posAttr = attributes.position;

	const disjointConnectivityMap = new Map();
	const fragmentMap = new Map();
	const edges = Array.from( unmatchedSet );
	const rays = new RaySet();

	for ( let i = 0, l = edges.length; i < l; i ++ ) {

		// get the triangle edge
		const index = edges[ i ];
		const triIndex = toTriIndex( index );
		const edgeIndex = toEdgeIndex( index );

		let i0 = 3 * triIndex + edgeIndex;
		let i1 = 3 * triIndex + ( edgeIndex + 1 ) % 3;
		if ( indexAttr ) {

			i0 = indexAttr.getX( i0 );
			i1 = indexAttr.getX( i1 );

		}

		_v0.fromBufferAttribute( posAttr, i0 );
		_v1.fromBufferAttribute( posAttr, i1 );

		// get the ray corresponding to the edge
		toNormalizedRay( _v0, _v1, _ray$2 );

		// find the shared ray with other edges
		let info;
		let commonRay = rays.findClosestRay( _ray$2 );
		if ( commonRay === null ) {

			commonRay = _ray$2.clone();
			rays.addRay( commonRay );

		}

		if ( ! fragmentMap.has( commonRay ) ) {

			fragmentMap.set( commonRay, {

				forward: [],
				reverse: [],
				ray: commonRay,

			} );

		}

		info = fragmentMap.get( commonRay );

		// store the stride of edge endpoints along the ray
		let start = getProjectedDistance( commonRay, _v0 );
		let end = getProjectedDistance( commonRay, _v1 );
		if ( start > end ) {

			[ start, end ] = [ end, start ];

		}

		if ( _ray$2.direction.dot( commonRay.direction ) < 0 ) {

			info.reverse.push( { start, end, index } );

		} else {

			info.forward.push( { start, end, index } );

		}

	}

	// match the found sibling edges
	fragmentMap.forEach( ( { forward, reverse }, ray ) => {

		matchEdges( forward, reverse, disjointConnectivityMap, eps );

		if ( forward.length === 0 && reverse.length === 0 ) {

			fragmentMap.delete( ray );

		}

	} );

	return {
		disjointConnectivityMap,
		fragmentMap,
	};

}

const _vec2$1 = new Vector2();
const _vec3$1 = new Vector3();
const _vec4 = new Vector4();
const _hashes = [ '', '', '' ];

class HalfEdgeMap {

	constructor( geometry = null ) {

		// result data
		this.data = null;
		this.disjointConnections = null;
		this.unmatchedDisjointEdges = null;
		this.unmatchedEdges = - 1;
		this.matchedEdges = - 1;

		// options
		this.useDrawRange = true;
		this.useAllAttributes = false;
		this.matchDisjointEdges = false;
		this.degenerateEpsilon = 1e-8;

		if ( geometry ) {

			this.updateFrom( geometry );

		}

	}

	getSiblingTriangleIndex( triIndex, edgeIndex ) {

		const otherIndex = this.data[ triIndex * 3 + edgeIndex ];
		return otherIndex === - 1 ? - 1 : ~ ~ ( otherIndex / 3 );

	}

	getSiblingEdgeIndex( triIndex, edgeIndex ) {

		const otherIndex = this.data[ triIndex * 3 + edgeIndex ];
		return otherIndex === - 1 ? - 1 : ( otherIndex % 3 );

	}

	getDisjointSiblingTriangleIndices( triIndex, edgeIndex ) {

		const index = triIndex * 3 + edgeIndex;
		const arr = this.disjointConnections.get( index );
		return arr ? arr.map( i => ~ ~ ( i / 3 ) ) : [];

	}

	getDisjointSiblingEdgeIndices( triIndex, edgeIndex ) {

		const index = triIndex * 3 + edgeIndex;
		const arr = this.disjointConnections.get( index );
		return arr ? arr.map( i => i % 3 ) : [];

	}

	isFullyConnected() {

		return this.unmatchedEdges === 0;

	}

	updateFrom( geometry ) {

		const { useAllAttributes, useDrawRange, matchDisjointEdges, degenerateEpsilon } = this;
		const hashFunction = useAllAttributes ? hashAllAttributes : hashPositionAttribute;

		// runs on the assumption that there is a 1 : 1 match of edges
		const map = new Map();

		// attributes
		const { attributes } = geometry;
		const attrKeys = useAllAttributes ? Object.keys( attributes ) : null;
		const indexAttr = geometry.index;
		const posAttr = attributes.position;

		// get the potential number of triangles
		let triCount = getTriCount( geometry );
		const maxTriCount = triCount;

		// get the real number of triangles from the based on the draw range
		let offset = 0;
		if ( useDrawRange ) {

			offset = geometry.drawRange.start;
			if ( geometry.drawRange.count !== Infinity ) {

				triCount = ~ ~ ( geometry.drawRange.count / 3 );

			}

		}

		// initialize the connectivity buffer - 1 means no connectivity
		let data = this.data;
		if ( ! data || data.length < 3 * maxTriCount ) {

			data = new Int32Array( 3 * maxTriCount );

		}

		data.fill( - 1 );

		// iterate over all triangles
		let matchedEdges = 0;
		let unmatchedSet = new Set();
		for ( let i = offset, l = triCount * 3 + offset; i < l; i += 3 ) {

			const i3 = i;
			for ( let e = 0; e < 3; e ++ ) {

				let i0 = i3 + e;
				if ( indexAttr ) {

					i0 = indexAttr.getX( i0 );

				}

				_hashes[ e ] = hashFunction( i0 );

			}

			for ( let e = 0; e < 3; e ++ ) {

				const nextE = ( e + 1 ) % 3;
				const vh0 = _hashes[ e ];
				const vh1 = _hashes[ nextE ];

				const reverseHash = `${ vh1 }_${ vh0 }`;
				if ( map.has( reverseHash ) ) {

					// create a reference between the two triangles and clear the hash
					const index = i3 + e;
					const otherIndex = map.get( reverseHash );
					data[ index ] = otherIndex;
					data[ otherIndex ] = index;
					map.delete( reverseHash );
					matchedEdges += 2;
					unmatchedSet.delete( otherIndex );

				} else {

					// save the triangle and triangle edge index captured in one value
					// triIndex = ~ ~ ( i0 / 3 );
					// edgeIndex = i0 % 3;
					const hash = `${ vh0 }_${ vh1 }`;
					const index = i3 + e;
					map.set( hash, index );
					unmatchedSet.add( index );

				}

			}

		}

		if ( matchDisjointEdges ) {

			const {
				fragmentMap,
				disjointConnectivityMap,
			} = computeDisjointEdges( geometry, unmatchedSet, degenerateEpsilon );

			unmatchedSet.clear();
			fragmentMap.forEach( ( { forward, reverse } ) => {

				forward.forEach( ( { index } ) => unmatchedSet.add( index ) );
				reverse.forEach( ( { index } ) => unmatchedSet.add( index ) );

			} );

			this.unmatchedDisjointEdges = fragmentMap;
			this.disjointConnections = disjointConnectivityMap;
			matchedEdges = triCount * 3 - unmatchedSet.size;

		}

		this.matchedEdges = matchedEdges;
		this.unmatchedEdges = unmatchedSet.size;
		this.data = data;

		function hashPositionAttribute( i ) {

			_vec3$1.fromBufferAttribute( posAttr, i );
			return hashVertex3( _vec3$1 );

		}

		function hashAllAttributes( i ) {

			let result = '';
			for ( let k = 0, l = attrKeys.length; k < l; k ++ ) {

				const attr = attributes[ attrKeys[ k ] ];
				let str;
				switch ( attr.itemSize ) {

					case 1:
						str = hashNumber( attr.getX( i ) );
						break;
					case 2:
						str = hashVertex2( _vec2$1.fromBufferAttribute( attr, i ) );
						break;
					case 3:
						str = hashVertex3( _vec3$1.fromBufferAttribute( attr, i ) );
						break;
					case 4:
						str = hashVertex4( _vec4.fromBufferAttribute( attr, i ) );
						break;

				}

				if ( result !== '' ) {

					result += '|';

				}

				result += str;

			}

			return result;

		}

	}

}

class Brush extends Mesh {

	constructor( ...args ) {

		super( ...args );

		this.isBrush = true;
		this._previousMatrix = new Matrix4();
		this._previousMatrix.elements.fill( 0 );

	}

	markUpdated() {

		this._previousMatrix.copy( this.matrix );

	}

	isDirty() {

		const { matrix, _previousMatrix } = this;
		const el1 = matrix.elements;
		const el2 = _previousMatrix.elements;
		for ( let i = 0; i < 16; i ++ ) {

			if ( el1[ i ] !== el2[ i ] ) {

				return true;

			}

		}

		return false;

	}

	prepareGeometry() {

		// generate shared array buffers
		const geometry = this.geometry;
		const attributes = geometry.attributes;
		const useSharedArrayBuffer = areSharedArrayBuffersSupported();
		if ( useSharedArrayBuffer ) {

			for ( const key in attributes ) {

				const attribute = attributes[ key ];
				if ( attribute.isInterleavedBufferAttribute ) {

					throw new Error( 'Brush: InterleavedBufferAttributes are not supported.' );

				}

				attribute.array = convertToSharedArrayBuffer( attribute.array );

			}

		}

		// generate bounds tree
		if ( ! geometry.boundsTree ) {

			ensureIndex( geometry, { useSharedArrayBuffer } );
			geometry.boundsTree = new MeshBVH( geometry, { maxLeafTris: 3, indirect: true, useSharedArrayBuffer } );

		}

		// generate half edges
		if ( ! geometry.halfEdges ) {

			geometry.halfEdges = new HalfEdgeMap( geometry );

		}

		// save group indices for materials
		if ( ! geometry.groupIndices ) {

			const triCount = getTriCount( geometry );
			const array = new Uint16Array( triCount );
			const groups = geometry.groups;
			for ( let i = 0, l = groups.length; i < l; i ++ ) {

				const { start, count } = groups[ i ];
				for ( let g = start / 3, lg = ( start + count ) / 3; g < lg; g ++ ) {

					array[ g ] = i;

				}

			}

			geometry.groupIndices = array;

		}

	}

	disposeCacheData() {

		const { geometry } = this;
		geometry.halfEdges = null;
		geometry.boundsTree = null;
		geometry.groupIndices = null;

	}

}

const EPSILON$1 = 1e-14;
const _AB = new Vector3();
const _AC = new Vector3();
const _CB = new Vector3();

function isTriDegenerate( tri, eps = EPSILON$1 ) {

	// compute angles to determine whether they're degenerate
	_AB.subVectors( tri.b, tri.a );
	_AC.subVectors( tri.c, tri.a );
	_CB.subVectors( tri.b, tri.c );

	const angle1 = _AB.angleTo( _AC );				// AB v AC
	const angle2 = _AB.angleTo( _CB );				// AB v BC
	const angle3 = Math.PI - angle1 - angle2;		// 180deg - angle1 - angle2

	return Math.abs( angle1 ) < eps ||
		Math.abs( angle2 ) < eps ||
		Math.abs( angle3 ) < eps ||
		tri.a.distanceToSquared( tri.b ) < eps ||
		tri.a.distanceToSquared( tri.c ) < eps ||
		tri.b.distanceToSquared( tri.c ) < eps;

}

// NOTE: these epsilons likely should all be the same since they're used to measure the
// distance from a point to a plane which needs to be done consistently
const EPSILON = 1e-10;
const COPLANAR_EPSILON = 1e-10;
const PARALLEL_EPSILON = 1e-10;
const _edge$2 = new Line3();
const _foundEdge = new Line3();
const _vec$1 = new Vector3();
const _triangleNormal = new Vector3();
const _planeNormal = new Vector3();
const _plane$1 = new Plane();
const _splittingTriangle = new ExtendedTriangle();

// A pool of triangles to avoid unnecessary triangle creation
class TrianglePool {

	constructor() {

		this._pool = [];
		this._index = 0;

	}

	getTriangle() {

		if ( this._index >= this._pool.length ) {

			this._pool.push( new Triangle() );

		}

		return this._pool[ this._index ++ ];

	}

	clear() {

		this._index = 0;

	}

	reset() {

		this._pool.length = 0;
		this._index = 0;

	}

}

// Utility class for splitting triangles
class TriangleSplitter {

	constructor() {

		this.trianglePool = new TrianglePool();
		this.triangles = [];
		this.normal = new Vector3();
		this.coplanarTriangleUsed = false;

	}

	// initialize the class with a triangle
	initialize( tri ) {

		this.reset();

		const { triangles, trianglePool, normal } = this;
		if ( Array.isArray( tri ) ) {

			for ( let i = 0, l = tri.length; i < l; i ++ ) {

				const t = tri[ i ];
				if ( i === 0 ) {

					t.getNormal( normal );

				} else if ( Math.abs( 1.0 - t.getNormal( _vec$1 ).dot( normal ) ) > EPSILON ) {

					throw new Error( 'Triangle Splitter: Cannot initialize with triangles that have different normals.' );

				}

				const poolTri = trianglePool.getTriangle();
				poolTri.copy( t );
				triangles.push( poolTri );

			}

		} else {

			tri.getNormal( normal );

			const poolTri = trianglePool.getTriangle();
			poolTri.copy( tri );
			triangles.push( poolTri );

		}

	}

	// Split the current set of triangles by passing a single triangle in. If the triangle is
	// coplanar it will attempt to split by the triangle edge planes
	splitByTriangle( triangle ) {

		const { normal, triangles } = this;
		triangle.getNormal( _triangleNormal ).normalize();

		if ( Math.abs( 1.0 - Math.abs( _triangleNormal.dot( normal ) ) ) < PARALLEL_EPSILON ) {

			this.coplanarTriangleUsed = true;

			for ( let i = 0, l = triangles.length; i < l; i ++ ) {

				const t = triangles[ i ];
				t.coplanarCount = 0;

			}

			// if the triangle is coplanar then split by the edge planes
			const arr = [ triangle.a, triangle.b, triangle.c ];
			for ( let i = 0; i < 3; i ++ ) {

				const nexti = ( i + 1 ) % 3;

				const v0 = arr[ i ];
				const v1 = arr[ nexti ];

				// plane positive direction is toward triangle center
				_vec$1.subVectors( v1, v0 ).normalize();
				_planeNormal.crossVectors( _triangleNormal, _vec$1 );
				_plane$1.setFromNormalAndCoplanarPoint( _planeNormal, v0 );

				this.splitByPlane( _plane$1, triangle );

			}

		} else {

			// otherwise split by the triangle plane
			triangle.getPlane( _plane$1 );
			this.splitByPlane( _plane$1, triangle );

		}

	}

	// Split the triangles by the given plan. If a triangle is provided then we ensure we
	// intersect the triangle before splitting the plane
	splitByPlane( plane, clippingTriangle ) {

		const { triangles, trianglePool } = this;

		// init our triangle to check for intersection
		_splittingTriangle.copy( clippingTriangle );
		_splittingTriangle.needsUpdate = true;

		// try to split every triangle in the class
		for ( let i = 0, l = triangles.length; i < l; i ++ ) {

			const tri = triangles[ i ];

			// skip the triangle if we don't intersect with it
			if ( ! _splittingTriangle.intersectsTriangle( tri, _edge$2, true ) ) {

				continue;

			}

			const { a, b, c } = tri;
			let intersects = 0;
			let vertexSplitEnd = - 1;
			let coplanarEdge = false;
			let posSideVerts = [];
			let negSideVerts = [];
			const arr = [ a, b, c ];
			for ( let t = 0; t < 3; t ++ ) {

				// get the triangle edge
				const tNext = ( t + 1 ) % 3;
				_edge$2.start.copy( arr[ t ] );
				_edge$2.end.copy( arr[ tNext ] );

				// track if the start point sits on the plane or if it's on the positive side of it
				// so we can use that information to determine whether to split later.
				const startDist = plane.distanceToPoint( _edge$2.start );
				const endDist = plane.distanceToPoint( _edge$2.end );
				if ( Math.abs( startDist ) < COPLANAR_EPSILON && Math.abs( endDist ) < COPLANAR_EPSILON ) {

					coplanarEdge = true;
					break;

				}

				if ( startDist > 0 ) {

					posSideVerts.push( t );

				} else {

					negSideVerts.push( t );

				}

				// we only don't consider this an intersection if the start points hits the plane
				if ( Math.abs( startDist ) < COPLANAR_EPSILON ) {

					continue;

				}

				// double check the end point since the "intersectLine" function sometimes does not
				// return it as an intersection (see issue #28)
				// Because we ignore the start point intersection above we have to make sure we check the end
				// point intersection here.
				let didIntersect = ! ! plane.intersectLine( _edge$2, _vec$1 );
				if ( ! didIntersect && Math.abs( endDist ) < COPLANAR_EPSILON ) {

					_vec$1.copy( _edge$2.end );
					didIntersect = true;

				}

				// check if we intersect the plane (ignoring the start point so we don't double count)
				if ( didIntersect && ! ( _vec$1.distanceTo( _edge$2.start ) < EPSILON ) ) {

					// if we intersect at the end point then we track that point as one that we
					// have to split down the middle
					if ( _vec$1.distanceTo( _edge$2.end ) < EPSILON ) {

						vertexSplitEnd = t;

					}

					// track the split edge
					if ( intersects === 0 ) {

						_foundEdge.start.copy( _vec$1 );

					} else {

						_foundEdge.end.copy( _vec$1 );

					}

					intersects ++;

				}

			}

			// skip splitting if:
			// - we have two points on the plane then the plane intersects the triangle exactly on an edge
			// - the plane does not intersect on 2 points
			// - the intersection edge is too small
			// - we're not along a coplanar edge
			if ( ! coplanarEdge && intersects === 2 && _foundEdge.distance() > COPLANAR_EPSILON ) {

				if ( vertexSplitEnd !== - 1 ) {

					vertexSplitEnd = ( vertexSplitEnd + 1 ) % 3;

					// we're splitting along a vertex
					let otherVert1 = 0;
					if ( otherVert1 === vertexSplitEnd ) {

						otherVert1 = ( otherVert1 + 1 ) % 3;

					}

					let otherVert2 = otherVert1 + 1;
					if ( otherVert2 === vertexSplitEnd ) {

						otherVert2 = ( otherVert2 + 1 ) % 3;

					}

					const nextTri = trianglePool.getTriangle();
					nextTri.a.copy( arr[ otherVert2 ] );
					nextTri.b.copy( _foundEdge.end );
					nextTri.c.copy( _foundEdge.start );

					if ( ! isTriDegenerate( nextTri ) ) {

						triangles.push( nextTri );

					}

					tri.a.copy( arr[ otherVert1 ] );
					tri.b.copy( _foundEdge.start );
					tri.c.copy( _foundEdge.end );

					// finish off the adjusted triangle
					if ( isTriDegenerate( tri ) ) {

						triangles.splice( i, 1 );
						i --;
						l --;

					}

				} else {

					// we're splitting with a quad and a triangle
					// TODO: what happens when we find that about the pos and negative
					// sides have only a single vertex?
					const singleVert =
						posSideVerts.length >= 2 ?
							negSideVerts[ 0 ] :
							posSideVerts[ 0 ];

					// swap the direction of the intersection edge depending on which
					// side of the plane the single vertex is on to align with the
					// correct winding order.
					if ( singleVert === 0 ) {

						let tmp = _foundEdge.start;
						_foundEdge.start = _foundEdge.end;
						_foundEdge.end = tmp;

					}

					const nextVert1 = ( singleVert + 1 ) % 3;
					const nextVert2 = ( singleVert + 2 ) % 3;

					const nextTri1 = trianglePool.getTriangle();
					const nextTri2 = trianglePool.getTriangle();

					// choose the triangle that has the larger areas (shortest split distance)
					if ( arr[ nextVert1 ].distanceToSquared( _foundEdge.start ) < arr[ nextVert2 ].distanceToSquared( _foundEdge.end ) ) {

						nextTri1.a.copy( arr[ nextVert1 ] );
						nextTri1.b.copy( _foundEdge.start );
						nextTri1.c.copy( _foundEdge.end );

						nextTri2.a.copy( arr[ nextVert1 ] );
						nextTri2.b.copy( arr[ nextVert2 ] );
						nextTri2.c.copy( _foundEdge.start );

					} else {

						nextTri1.a.copy( arr[ nextVert2 ] );
						nextTri1.b.copy( _foundEdge.start );
						nextTri1.c.copy( _foundEdge.end );

						nextTri2.a.copy( arr[ nextVert1 ] );
						nextTri2.b.copy( arr[ nextVert2 ] );
						nextTri2.c.copy( _foundEdge.end );

					}

					tri.a.copy( arr[ singleVert ] );
					tri.b.copy( _foundEdge.end );
					tri.c.copy( _foundEdge.start );

					// don't add degenerate triangles to the list
					if ( ! isTriDegenerate( nextTri1 ) ) {

						triangles.push( nextTri1 );

					}

					if ( ! isTriDegenerate( nextTri2 ) ) {

						triangles.push( nextTri2 );

					}

					// finish off the adjusted triangle
					if ( isTriDegenerate( tri ) ) {

						triangles.splice( i, 1 );
						i --;
						l --;

					}

				}

			} else if ( intersects === 3 ) {

				console.warn( 'TriangleClipper: Coplanar clip not handled' );

			}

		}

	}

	reset() {

		this.triangles.length = 0;
		this.trianglePool.clear();
		this.coplanarTriangleUsed = false;

	}

}

function ceilToFourByteStride( byteLength ) {

	byteLength = ~ ~ byteLength;
	return byteLength + 4 - byteLength % 4;

}

// Make a new array wrapper class that more easily affords expansion when reaching it's max capacity
class TypeBackedArray {

	constructor( type, initialSize = 500 ) {


		this.expansionFactor = 1.5;
		this.type = type;
		this.length = 0;
		this.array = null;

		this.setSize( initialSize );

	}

	setType( type ) {

		if ( this.length !== 0 ) {

			throw new Error( 'TypeBackedArray: Cannot change the type while there is used data in the buffer.' );

		}

		const buffer = this.array.buffer;
		this.array = new type( buffer );
		this.type = type;

	}

	setSize( size ) {

		if ( this.array && size === this.array.length ) {

			return;

		}

		// ceil to the nearest 4 bytes so we can replace the array with any type using the same buffer
		const type = this.type;
		const bufferType = areSharedArrayBuffersSupported() ? SharedArrayBuffer : ArrayBuffer;
		const newArray = new type( new bufferType( ceilToFourByteStride( size * type.BYTES_PER_ELEMENT ) ) );
		if ( this.array ) {

			newArray.set( this.array, 0 );

		}

		this.array = newArray;

	}

	expand() {

		const { array, expansionFactor } = this;
		this.setSize( array.length * expansionFactor );

	}

	push( ...args ) {

		let { array, length } = this;
		if ( length + args.length > array.length ) {

			this.expand();
			array = this.array;

		}

		for ( let i = 0, l = args.length; i < l; i ++ ) {

			array[ length + i ] = args[ i ];

		}

		this.length += args.length;

	}

	clear() {

		this.length = 0;

	}

}

// Utility class for for tracking attribute data in type-backed arrays for a set
// of groups. The set of attributes is kept for each group and are expected to be the
// same buffer type.
class TypedAttributeData {

	constructor() {

		this.groupAttributes = [ {} ];
		this.groupCount = 0;

	}

	// returns the buffer type for the given attribute
	getType( name ) {

		return this.groupAttributes[ 0 ][ name ].type;

	}

	getItemSize( name ) {

		return this.groupAttributes[ 0 ][ name ].itemSize;

	}

	getNormalized( name ) {

		return this.groupAttributes[ 0 ][ name ].normalized;

	}

	getCount( index ) {

		if ( this.groupCount <= index ) {

			return 0;

		}

		const pos = this.getGroupAttrArray( 'position', index );
		return pos.length / pos.itemSize;

	}

	// returns the total length required for all groups for the given attribute
	getTotalLength( name ) {

		const { groupCount, groupAttributes } = this;

		let length = 0;
		for ( let i = 0; i < groupCount; i ++ ) {

			const attrSet = groupAttributes[ i ];
			length += attrSet[ name ].length;

		}

		return length;

	}

	getGroupAttrSet( index = 0 ) {

		// TODO: can this be abstracted?
		// Return the exiting group set if necessary
		const { groupAttributes } = this;
		if ( groupAttributes[ index ] ) {

			this.groupCount = Math.max( this.groupCount, index + 1 );
			return groupAttributes[ index ];

		}

		// add any new group sets required
		const refAttrSet = groupAttributes[ 0 ];
		this.groupCount = Math.max( this.groupCount, index + 1 );
		while ( index >= groupAttributes.length ) {

			const newAttrSet = {};
			groupAttributes.push( newAttrSet );
			for ( const key in refAttrSet ) {

				const refAttr = refAttrSet[ key ];
				const newAttr = new TypeBackedArray( refAttr.type );
				newAttr.itemSize = refAttr.itemSize;
				newAttr.normalized = refAttr.normalized;
				newAttrSet[ key ] = newAttr;

			}

		}

		return groupAttributes[ index ];

	}

	// Get the raw array for the group set of data
	getGroupAttrArray( name, index = 0 ) {

		// throw an error if we've never
		const { groupAttributes } = this;
		const referenceAttrSet = groupAttributes[ 0 ];
		const referenceAttr = referenceAttrSet[ name ];
		if ( ! referenceAttr ) {

			throw new Error( `TypedAttributeData: Attribute with "${ name }" has not been initialized` );

		}

		return this.getGroupAttrSet( index )[ name ];

	}

	// initializes an attribute array with the given name, type, and size
	initializeArray( name, type, itemSize, normalized ) {

		const { groupAttributes } = this;
		const referenceAttrSet = groupAttributes[ 0 ];
		const referenceAttr = referenceAttrSet[ name ];
		if ( referenceAttr ) {

			if ( referenceAttr.type !== type ) {

				for ( let i = 0, l = groupAttributes.length; i < l; i ++ ) {

					const arr = groupAttributes[ i ][ name ];
					arr.setType( type );
					arr.itemSize = itemSize;
					arr.normalized = normalized;

				}

			}

		} else {

			for ( let i = 0, l = groupAttributes.length; i < l; i ++ ) {

				const arr = new TypeBackedArray( type );
				arr.itemSize = itemSize;
				arr.normalized = normalized;
				groupAttributes[ i ][ name ] = arr;

			}

		}

	}

	// Clear all the data
	clear() {

		this.groupCount = 0;

		const { groupAttributes } = this;
		groupAttributes.forEach( attrSet => {

			for ( const key in attrSet ) {

				attrSet[ key ].clear();

			}


		} );

	}

	// Remove the given key
	delete( key ) {

		this.groupAttributes.forEach( attrSet => {

			delete attrSet[ key ];

		} );

	}

	// Reset the datasets completely
	reset() {

		this.groupAttributes = [];
		this.groupCount = 0;

	}

}

class IntersectionMap {

	constructor() {

		this.intersectionSet = {};
		this.ids = [];

	}

	add( id, intersectionId ) {

		const { intersectionSet, ids } = this;
		if ( ! intersectionSet[ id ] ) {

			intersectionSet[ id ] = [];
			ids.push( id );

		}

		intersectionSet[ id ].push( intersectionId );

	}

}

const ADDITION = 0;
const SUBTRACTION = 1;
const REVERSE_SUBTRACTION = 2;
const INTERSECTION = 3;
const DIFFERENCE = 4;

// guaranteed non manifold results
const HOLLOW_SUBTRACTION = 5;
const HOLLOW_INTERSECTION = 6;

const _ray$1 = new Ray();
const _matrix$2 = new Matrix4();
const _tri$2 = new Triangle();
const _vec3 = new Vector3();
const _vec4a = new Vector4();
const _vec4b = new Vector4();
const _vec4c = new Vector4();
const _vec4_0 = new Vector4();
const _vec4_1 = new Vector4();
const _vec4_2 = new Vector4();
const _edge$1 = new Line3();
const _normal$1 = new Vector3();
const JITTER_EPSILON = 1e-8;
const OFFSET_EPSILON = 1e-15;

const BACK_SIDE = - 1;
const FRONT_SIDE = 1;
const COPLANAR_OPPOSITE = - 2;
const COPLANAR_ALIGNED = 2;

const INVERT_TRI = 0;
const ADD_TRI = 1;
const SKIP_TRI = 2;

const FLOATING_COPLANAR_EPSILON = 1e-14;

let _debugContext = null;
function setDebugContext( debugData ) {

	_debugContext = debugData;

}

function getHitSide( tri, bvh ) {

	tri.getMidpoint( _ray$1.origin );
	tri.getNormal( _ray$1.direction );

	const hit = bvh.raycastFirst( _ray$1, DoubleSide );
	const hitBackSide = Boolean( hit && _ray$1.direction.dot( hit.face.normal ) > 0 );
	return hitBackSide ? BACK_SIDE : FRONT_SIDE;

}

function getHitSideWithCoplanarCheck( tri, bvh ) {

	// random function that returns [ - 0.5, 0.5 ];
	function rand() {

		return Math.random() - 0.5;

	}

	// get the ray the check the triangle for
	tri.getNormal( _normal$1 );
	_ray$1.direction.copy( _normal$1 );
	tri.getMidpoint( _ray$1.origin );

	const total = 3;
	let count = 0;
	let minDistance = Infinity;
	for ( let i = 0; i < total; i ++ ) {

		// jitter the ray slightly
		_ray$1.direction.x += rand() * JITTER_EPSILON;
		_ray$1.direction.y += rand() * JITTER_EPSILON;
		_ray$1.direction.z += rand() * JITTER_EPSILON;

		// and invert it so we can account for floating point error by checking both directions
		// to catch coplanar distances
		_ray$1.direction.multiplyScalar( - 1 );

		// check if the ray hit the backside
		const hit = bvh.raycastFirst( _ray$1, DoubleSide );
		let hitBackSide = Boolean( hit && _ray$1.direction.dot( hit.face.normal ) > 0 );
		if ( hitBackSide ) {

			count ++;

		}

		if ( hit !== null ) {

			minDistance = Math.min( minDistance, hit.distance );

		}

		// if we're right up against another face then we're coplanar
		if ( minDistance <= OFFSET_EPSILON ) {

			return hit.face.normal.dot( _normal$1 ) > 0 ? COPLANAR_ALIGNED : COPLANAR_OPPOSITE;

		}

		// if our current casts meet our requirements then early out
		if ( count / total > 0.5 || ( i - count + 1 ) / total > 0.5 ) {

			break;

		}

	}

	return count / total > 0.5 ? BACK_SIDE : FRONT_SIDE;

}

// returns the intersected triangles and returns objects mapping triangle indices to
// the other triangles intersected
function collectIntersectingTriangles( a, b ) {

	const aIntersections = new IntersectionMap();
	const bIntersections = new IntersectionMap();

	_matrix$2
		.copy( a.matrixWorld )
		.invert()
		.multiply( b.matrixWorld );

	a.geometry.boundsTree.bvhcast( b.geometry.boundsTree, _matrix$2, {

		intersectsTriangles( triangleA, triangleB, ia, ib ) {

			if ( ! isTriDegenerate( triangleA ) && ! isTriDegenerate( triangleB ) ) {

				// due to floating point error it's possible that we can have two overlapping, coplanar triangles
				// that are a _tiny_ fraction of a value away from each other. If we find that case then check the
				// distance between triangles and if it's small enough consider them intersecting.
				let intersected = triangleA.intersectsTriangle( triangleB, _edge$1, true );
				if ( ! intersected ) {

					const pa = triangleA.plane;
					const pb = triangleB.plane;
					const na = pa.normal;
					const nb = pb.normal;

					if ( na.dot( nb ) === 1 && Math.abs( pa.constant - pb.constant ) < FLOATING_COPLANAR_EPSILON ) {

						intersected = true;

					}

				}

				if ( intersected ) {

					let va = a.geometry.boundsTree.resolveTriangleIndex( ia );
					let vb = b.geometry.boundsTree.resolveTriangleIndex( ib );
					aIntersections.add( va, vb );
					bIntersections.add( vb, va );

					if ( _debugContext ) {

						_debugContext.addEdge( _edge$1 );
						_debugContext.addIntersectingTriangles( ia, triangleA, ib, triangleB );

					}

				}

			}

			return false;

		}

	} );

	return { aIntersections, bIntersections };

}

// Add the barycentric interpolated values fro the triangle into the new attribute data
function appendAttributeFromTriangle(
	triIndex,
	baryCoordTri,
	geometry,
	matrixWorld,
	normalMatrix,
	attributeData,
	invert = false,
) {

	const attributes = geometry.attributes;
	const indexAttr = geometry.index;
	const i3 = triIndex * 3;
	const i0 = indexAttr.getX( i3 + 0 );
	const i1 = indexAttr.getX( i3 + 1 );
	const i2 = indexAttr.getX( i3 + 2 );

	for ( const key in attributeData ) {

		// check if the key we're asking for is in the geometry at all
		const attr = attributes[ key ];
		const arr = attributeData[ key ];
		if ( ! ( key in attributes ) ) {

			throw new Error( `CSG Operations: Attribute ${ key } not available on geometry.` );

		}

		// handle normals and positions specially because they require transforming
		// TODO: handle tangents
		const itemSize = attr.itemSize;
		if ( key === 'position' ) {

			_tri$2.a.fromBufferAttribute( attr, i0 ).applyMatrix4( matrixWorld );
			_tri$2.b.fromBufferAttribute( attr, i1 ).applyMatrix4( matrixWorld );
			_tri$2.c.fromBufferAttribute( attr, i2 ).applyMatrix4( matrixWorld );

			pushBarycoordInterpolatedValues( _tri$2.a, _tri$2.b, _tri$2.c, baryCoordTri, 3, arr, invert );

		} else if ( key === 'normal' ) {

			_tri$2.a.fromBufferAttribute( attr, i0 ).applyNormalMatrix( normalMatrix );
			_tri$2.b.fromBufferAttribute( attr, i1 ).applyNormalMatrix( normalMatrix );
			_tri$2.c.fromBufferAttribute( attr, i2 ).applyNormalMatrix( normalMatrix );

			if ( invert ) {

				_tri$2.a.multiplyScalar( - 1 );
				_tri$2.b.multiplyScalar( - 1 );
				_tri$2.c.multiplyScalar( - 1 );

			}

			pushBarycoordInterpolatedValues( _tri$2.a, _tri$2.b, _tri$2.c, baryCoordTri, 3, arr, invert, true );

		} else {

			_vec4a.fromBufferAttribute( attr, i0 );
			_vec4b.fromBufferAttribute( attr, i1 );
			_vec4c.fromBufferAttribute( attr, i2 );

			pushBarycoordInterpolatedValues( _vec4a, _vec4b, _vec4c, baryCoordTri, itemSize, arr, invert );

		}

	}

}

// Append all the values of the attributes for the triangle onto the new attribute arrays
function appendAttributesFromIndices(
	i0,
	i1,
	i2,
	attributes,
	matrixWorld,
	normalMatrix,
	attributeData,
	invert = false,
) {

	appendAttributeFromIndex( i0, attributes, matrixWorld, normalMatrix, attributeData, invert );
	appendAttributeFromIndex( invert ? i2 : i1, attributes, matrixWorld, normalMatrix, attributeData, invert );
	appendAttributeFromIndex( invert ? i1 : i2, attributes, matrixWorld, normalMatrix, attributeData, invert );

}

// Returns the triangle to add when performing an operation
function getOperationAction( operation, hitSide, invert = false ) {

	switch ( operation ) {

		case ADDITION:

			if ( hitSide === FRONT_SIDE || ( hitSide === COPLANAR_ALIGNED && ! invert ) ) {

				return ADD_TRI;

			}

			break;
		case SUBTRACTION:

			if ( invert ) {

				if ( hitSide === BACK_SIDE ) {

					return INVERT_TRI;

				}

			} else {

				if ( hitSide === FRONT_SIDE || hitSide === COPLANAR_OPPOSITE ) {

					return ADD_TRI;

				}

			}

			break;
		case REVERSE_SUBTRACTION:

			if ( invert ) {

				if ( hitSide === FRONT_SIDE || hitSide === COPLANAR_OPPOSITE ) {

					return ADD_TRI;

				}

			} else {

				if ( hitSide === BACK_SIDE ) {

					return INVERT_TRI;

				}

			}

			break;
		case DIFFERENCE:

			if ( hitSide === BACK_SIDE ) {

				return INVERT_TRI;

			} else if ( hitSide === FRONT_SIDE ) {

				return ADD_TRI;

			}

			break;
		case INTERSECTION:
			if ( hitSide === BACK_SIDE || ( hitSide === COPLANAR_ALIGNED && ! invert ) ) {

				return ADD_TRI;

			}

			break;

		case HOLLOW_SUBTRACTION:
			if ( ! invert && ( hitSide === FRONT_SIDE || hitSide === COPLANAR_OPPOSITE ) ) {

				return ADD_TRI;

			}

			break;
		case HOLLOW_INTERSECTION:
			if ( ! invert && ( hitSide === BACK_SIDE || hitSide === COPLANAR_ALIGNED ) ) {

				return ADD_TRI;

			}

			break;
		default:
			throw new Error( `Unrecognized CSG operation enum "${ operation }".` );

	}

	return SKIP_TRI;

}

// takes a set of barycentric values in the form of a triangle, a set of vectors, number of components,
// and whether to invert the result and pushes the new values onto the provided attribute array
function pushBarycoordInterpolatedValues( v0, v1, v2, baryCoordTri, itemSize, attrArr, invert = false, normalize = false ) {

	// adds the appropriate number of values for the vector onto the array
	const addValues = v => {

		attrArr.push( v.x );
		if ( itemSize > 1 ) attrArr.push( v.y );
		if ( itemSize > 2 ) attrArr.push( v.z );
		if ( itemSize > 3 ) attrArr.push( v.w );

	};

	// barycentric interpolate the first component
	_vec4_0.set( 0, 0, 0, 0 )
		.addScaledVector( v0, baryCoordTri.a.x )
		.addScaledVector( v1, baryCoordTri.a.y )
		.addScaledVector( v2, baryCoordTri.a.z );

	_vec4_1.set( 0, 0, 0, 0 )
		.addScaledVector( v0, baryCoordTri.b.x )
		.addScaledVector( v1, baryCoordTri.b.y )
		.addScaledVector( v2, baryCoordTri.b.z );

	_vec4_2.set( 0, 0, 0, 0 )
		.addScaledVector( v0, baryCoordTri.c.x )
		.addScaledVector( v1, baryCoordTri.c.y )
		.addScaledVector( v2, baryCoordTri.c.z );

	if ( normalize ) {

		_vec4_0.normalize();
		_vec4_1.normalize();
		_vec4_2.normalize();

	}

	// if the face is inverted then add the values in an inverted order
	addValues( _vec4_0 );

	if ( invert ) {

		addValues( _vec4_2 );
		addValues( _vec4_1 );

	} else {

		addValues( _vec4_1 );
		addValues( _vec4_2 );

	}

}

// Adds the values for the given vertex index onto the new attribute arrays
function appendAttributeFromIndex(
	index,
	attributes,
	matrixWorld,
	normalMatrix,
	attributeData,
	invert = false,
) {

	for ( const key in attributeData ) {

		// check if the key we're asking for is in the geometry at all
		const attr = attributes[ key ];
		const arr = attributeData[ key ];
		if ( ! ( key in attributes ) ) {

			throw new Error( `CSG Operations: Attribute ${ key } no available on geometry.` );

		}

		// specially handle the position and normal attributes because they require transforms
		// TODO: handle tangents
		const itemSize = attr.itemSize;
		if ( key === 'position' ) {

			_vec3.fromBufferAttribute( attr, index ).applyMatrix4( matrixWorld );
			arr.push( _vec3.x, _vec3.y, _vec3.z );

		} else if ( key === 'normal' ) {

			_vec3.fromBufferAttribute( attr, index ).applyNormalMatrix( normalMatrix );
			if ( invert ) {

				_vec3.multiplyScalar( - 1 );

			}

			arr.push( _vec3.x, _vec3.y, _vec3.z );

		} else {

			arr.push( attr.getX( index ) );
			if ( itemSize > 1 ) arr.push( attr.getY( index ) );
			if ( itemSize > 2 ) arr.push( attr.getZ( index ) );
			if ( itemSize > 3 ) arr.push( attr.getW( index ) );

		}

	}

}

class TriangleIntersectData {

	constructor( tri ) {

		this.triangle = new Triangle().copy( tri );
		this.intersects = {};

	}

	addTriangle( index, tri ) {

		this.intersects[ index ] = new Triangle().copy( tri );

	}

	getIntersectArray() {

		const array = [];
		const { intersects } = this;
		for ( const key in intersects ) {

			array.push( intersects[ key ] );

		}

		return array;

	}

}

class TriangleIntersectionSets {

	constructor() {

		this.data = {};

	}

	addTriangleIntersection( ia, triA, ib, triB ) {

		const { data } = this;
		if ( ! data[ ia ] ) {

			data[ ia ] = new TriangleIntersectData( triA );

		}

		data[ ia ].addTriangle( ib, triB );

	}

	getTrianglesAsArray( id = null ) {

		const { data } = this;
		const arr = [];

		if ( id !== null ) {

			if ( id in data ) {

				arr.push( data[ id ].triangle );

			}

		} else {

			for ( const key in data ) {

				arr.push( data[ key ].triangle );

			}

		}

		return arr;

	}

	getTriangleIndices() {

		return Object.keys( this.data ).map( i => parseInt( i ) );

	}

	getIntersectionIndices( id ) {

		const { data } = this;
		if ( ! data[ id ] ) {

			return [];

		} else {

			return Object.keys( data[ id ].intersects ).map( i => parseInt( i ) );


		}

	}

	getIntersectionsAsArray( id = null, id2 = null ) {

		const { data } = this;
		const triSet = new Set();
		const arr = [];

		const addTriangles = key => {

			if ( ! data[ key ] ) return;

			if ( id2 !== null ) {

				if ( data[ key ].intersects[ id2 ] ) {

					arr.push( data[ key ].intersects[ id2 ] );

				}

			} else {

				const intersects = data[ key ].intersects;
				for ( const key2 in intersects ) {

					if ( ! triSet.has( key2 ) ) {

						triSet.add( key2 );
						arr.push( intersects[ key2 ] );

					}

				}

			}

		};

		if ( id !== null ) {

			addTriangles( id );

		} else {

			for ( const key in data ) {

				addTriangles( key );

			}

		}

		return arr;

	}

	reset() {

		this.data = {};

	}

}

class OperationDebugData {

	constructor() {

		this.enabled = false;
		this.triangleIntersectsA = new TriangleIntersectionSets();
		this.triangleIntersectsB = new TriangleIntersectionSets();
		this.intersectionEdges = [];

	}

	addIntersectingTriangles( ia, triA, ib, triB ) {

		const { triangleIntersectsA, triangleIntersectsB } = this;
		triangleIntersectsA.addTriangleIntersection( ia, triA, ib, triB );
		triangleIntersectsB.addTriangleIntersection( ib, triB, ia, triA );

	}

	addEdge( edge ) {

		this.intersectionEdges.push( edge.clone() );

	}

	reset() {

		this.triangleIntersectsA.reset();
		this.triangleIntersectsB.reset();
		this.intersectionEdges = [];

	}

	init() {

		if ( this.enabled ) {

			this.reset();
			setDebugContext( this );

		}

	}

	complete() {

		if ( this.enabled ) {

			setDebugContext( null );

		}

	}

}

const _matrix$1 = new Matrix4();
const _normalMatrix = new Matrix3();
const _triA = new Triangle();
const _triB = new Triangle();
const _tri$1 = new Triangle();
const _barycoordTri = new Triangle();
const _attr = [];
const _actions = [];

function getFirstIdFromSet( set ) {

	for ( const id of set ) return id;

}

// runs the given operation against a and b using the splitter and appending data to the
// attributeData object.
function performOperation(
	a,
	b,
	operations,
	splitter,
	attributeData,
	options = {},
) {

	const { useGroups = true } = options;
	const { aIntersections, bIntersections } = collectIntersectingTriangles( a, b );

	const resultGroups = [];
	let resultMaterials = null;

	let groupOffset;
	groupOffset = useGroups ? 0 : - 1;
	performSplitTriangleOperations( a, b, aIntersections, operations, false, splitter, attributeData, groupOffset );
	performWholeTriangleOperations( a, b, aIntersections, operations, false, attributeData, groupOffset );

	// find whether the set of operations contains a non-hollow operations. If it does then we need
	// to perform the second set of triangle additions
	const nonHollow = operations
		.findIndex( op => op !== HOLLOW_INTERSECTION && op !== HOLLOW_SUBTRACTION ) !== - 1;

	if ( nonHollow ) {

		groupOffset = useGroups ? a.geometry.groups.length || 1 : - 1;
		performSplitTriangleOperations( b, a, bIntersections, operations, true, splitter, attributeData, groupOffset );
		performWholeTriangleOperations( b, a, bIntersections, operations, true, attributeData, groupOffset );

	}

	_attr.length = 0;
	_actions.length = 0;

	return {
		groups: resultGroups,
		materials: resultMaterials
	};

}

// perform triangle splitting and CSG operations on the set of split triangles
function performSplitTriangleOperations(
	a,
	b,
	intersectionMap,
	operations,
	invert,
	splitter,
	attributeData,
	groupOffset = 0,
) {

	const invertedGeometry = a.matrixWorld.determinant() < 0;

	// transforms into the local frame of matrix b
	_matrix$1
		.copy( b.matrixWorld )
		.invert()
		.multiply( a.matrixWorld );

	_normalMatrix
		.getNormalMatrix( a.matrixWorld )
		.multiplyScalar( invertedGeometry ? - 1 : 1 );

	const groupIndices = a.geometry.groupIndices;
	const aIndex = a.geometry.index;
	const aPosition = a.geometry.attributes.position;

	const bBVH = b.geometry.boundsTree;
	const bIndex = b.geometry.index;
	const bPosition = b.geometry.attributes.position;
	const splitIds = intersectionMap.ids;
	const intersectionSet = intersectionMap.intersectionSet;

	// iterate over all split triangle indices
	for ( let i = 0, l = splitIds.length; i < l; i ++ ) {

		const ia = splitIds[ i ];
		const groupIndex = groupOffset === - 1 ? 0 : groupIndices[ ia ] + groupOffset;

		// get the triangle in the geometry B local frame
		const ia3 = 3 * ia;
		const ia0 = aIndex.getX( ia3 + 0 );
		const ia1 = aIndex.getX( ia3 + 1 );
		const ia2 = aIndex.getX( ia3 + 2 );
		_triA.a.fromBufferAttribute( aPosition, ia0 ).applyMatrix4( _matrix$1 );
		_triA.b.fromBufferAttribute( aPosition, ia1 ).applyMatrix4( _matrix$1 );
		_triA.c.fromBufferAttribute( aPosition, ia2 ).applyMatrix4( _matrix$1 );

		// initialize the splitter with the triangle from geometry A
		splitter.reset();
		splitter.initialize( _triA );

		// split the triangle with the intersecting triangles from B
		const intersectingIndices = intersectionSet[ ia ];
		for ( let ib = 0, l = intersectingIndices.length; ib < l; ib ++ ) {

			const ib3 = 3 * intersectingIndices[ ib ];
			const ib0 = bIndex.getX( ib3 + 0 );
			const ib1 = bIndex.getX( ib3 + 1 );
			const ib2 = bIndex.getX( ib3 + 2 );
			_triB.a.fromBufferAttribute( bPosition, ib0 );
			_triB.b.fromBufferAttribute( bPosition, ib1 );
			_triB.c.fromBufferAttribute( bPosition, ib2 );
			splitter.splitByTriangle( _triB );

		}

		// for all triangles in the split result
		const triangles = splitter.triangles;
		for ( let ib = 0, l = triangles.length; ib < l; ib ++ ) {

			// get the barycentric coordinates of the clipped triangle to add
			const clippedTri = triangles[ ib ];

			// try to use the side derived from the clipping but if it turns out to be
			// uncertain then fall back to the raycasting approach
			const hitSide = splitter.coplanarTriangleUsed ?
				getHitSideWithCoplanarCheck( clippedTri, bBVH ) :
				getHitSide( clippedTri, bBVH );

			_attr.length = 0;
			_actions.length = 0;
			for ( let o = 0, lo = operations.length; o < lo; o ++ ) {

				const op = getOperationAction( operations[ o ], hitSide, invert );
				if ( op !== SKIP_TRI ) {

					_actions.push( op );
					_attr.push( attributeData[ o ].getGroupAttrSet( groupIndex ) );

				}

			}

			if ( _attr.length !== 0 ) {

				_triA.getBarycoord( clippedTri.a, _barycoordTri.a );
				_triA.getBarycoord( clippedTri.b, _barycoordTri.b );
				_triA.getBarycoord( clippedTri.c, _barycoordTri.c );

				for ( let k = 0, lk = _attr.length; k < lk; k ++ ) {

					const attrSet = _attr[ k ];
					const action = _actions[ k ];
					const invertTri = action === INVERT_TRI;
					appendAttributeFromTriangle( ia, _barycoordTri, a.geometry, a.matrixWorld, _normalMatrix, attrSet, invertedGeometry !== invertTri );

				}

			}

		}

	}

	return splitIds.length;

}

// perform CSG operations on the set of whole triangles using a half edge structure
// at the moment this isn't always faster due to overhead of building the half edge structure
// and degraded connectivity due to split triangles.

function performWholeTriangleOperations(
	a,
	b,
	splitTriSet,
	operations,
	invert,
	attributeData,
	groupOffset = 0,
) {

	const invertedGeometry = a.matrixWorld.determinant() < 0;

	// matrix for transforming into the local frame of geometry b
	_matrix$1
		.copy( b.matrixWorld )
		.invert()
		.multiply( a.matrixWorld );

	_normalMatrix
		.getNormalMatrix( a.matrixWorld )
		.multiplyScalar( invertedGeometry ? - 1 : 1 );

	const bBVH = b.geometry.boundsTree;
	const groupIndices = a.geometry.groupIndices;
	const aIndex = a.geometry.index;
	const aAttributes = a.geometry.attributes;
	const aPosition = aAttributes.position;

	const stack = [];
	const halfEdges = a.geometry.halfEdges;
	const traverseSet = new Set();
	const triCount = getTriCount( a.geometry );
	for ( let i = 0, l = triCount; i < l; i ++ ) {

		if ( ! ( i in splitTriSet.intersectionSet ) ) {

			traverseSet.add( i );

		}

	}

	while ( traverseSet.size > 0 ) {

		const id = getFirstIdFromSet( traverseSet );
		traverseSet.delete( id );

		stack.push( id );

		// get the vertex indices
		const i3 = 3 * id;
		const i0 = aIndex.getX( i3 + 0 );
		const i1 = aIndex.getX( i3 + 1 );
		const i2 = aIndex.getX( i3 + 2 );

		// get the vertex position in the frame of geometry b so we can
		// perform hit testing
		_tri$1.a.fromBufferAttribute( aPosition, i0 ).applyMatrix4( _matrix$1 );
		_tri$1.b.fromBufferAttribute( aPosition, i1 ).applyMatrix4( _matrix$1 );
		_tri$1.c.fromBufferAttribute( aPosition, i2 ).applyMatrix4( _matrix$1 );

		// get the side and decide if we need to cull the triangle based on the operation
		const hitSide = getHitSide( _tri$1, bBVH );

		_actions.length = 0;
		_attr.length = 0;
		for ( let o = 0, lo = operations.length; o < lo; o ++ ) {

			const op = getOperationAction( operations[ o ], hitSide, invert );
			if ( op !== SKIP_TRI ) {

				_actions.push( op );
				_attr.push( attributeData[ o ] );

			}

		}

		while ( stack.length > 0 ) {

			const currId = stack.pop();
			for ( let i = 0; i < 3; i ++ ) {

				const sid = halfEdges.getSiblingTriangleIndex( currId, i );
				if ( sid !== - 1 && traverseSet.has( sid ) ) {

					stack.push( sid );
					traverseSet.delete( sid );

				}

			}

			if ( _attr.length !== 0 ) {

				const i3 = 3 * currId;
				const i0 = aIndex.getX( i3 + 0 );
				const i1 = aIndex.getX( i3 + 1 );
				const i2 = aIndex.getX( i3 + 2 );
				const groupIndex = groupOffset === - 1 ? 0 : groupIndices[ currId ] + groupOffset;

				_tri$1.a.fromBufferAttribute( aPosition, i0 );
				_tri$1.b.fromBufferAttribute( aPosition, i1 );
				_tri$1.c.fromBufferAttribute( aPosition, i2 );
				if ( ! isTriDegenerate( _tri$1 ) ) {

					for ( let k = 0, lk = _attr.length; k < lk; k ++ ) {

						const action = _actions[ k ];
						const attrSet = _attr[ k ].getGroupAttrSet( groupIndex );
						const invertTri = action === INVERT_TRI;
						appendAttributesFromIndices( i0, i1, i2, aAttributes, a.matrixWorld, _normalMatrix, attrSet, invertTri !== invertedGeometry );

					}

				}

			}

		}

	}

}

// merges groups with common material indices in place
function joinGroups( groups ) {

	for ( let i = 0; i < groups.length - 1; i ++ ) {

		const group = groups[ i ];
		const nextGroup = groups[ i + 1 ];
		if ( group.materialIndex === nextGroup.materialIndex ) {

			const start = group.start;
			const end = nextGroup.start + nextGroup.count;
			nextGroup.start = start;
			nextGroup.count = end - start;

			groups.splice( i, 1 );
			i --;

		}

	}

}

// initialize the target geometry and attribute data to be based on
// the given reference geometry
function prepareAttributesData( referenceGeometry, targetGeometry, attributeData, relevantAttributes ) {

	attributeData.clear();

	// initialize and clear unused data from the attribute buffers and vice versa
	const aAttributes = referenceGeometry.attributes;
	for ( let i = 0, l = relevantAttributes.length; i < l; i ++ ) {

		const key = relevantAttributes[ i ];
		const aAttr = aAttributes[ key ];
		attributeData.initializeArray( key, aAttr.array.constructor, aAttr.itemSize, aAttr.normalized );

	}

	for ( const key in attributeData.attributes ) {

		if ( ! relevantAttributes.includes( key ) ) {

			attributeData.delete( key );

		}

	}

	for ( const key in targetGeometry.attributes ) {

		if ( ! relevantAttributes.includes( key ) ) {

			targetGeometry.deleteAttribute( key );
			targetGeometry.dispose();

		}

	}

}

// Assigns the given tracked attribute data to the geometry and returns whether the
// geometry needs to be disposed of.
function assignBufferData( geometry, attributeData, groupOrder ) {

	let needsDisposal = false;
	let drawRange = - 1;

	// set the data
	const attributes = geometry.attributes;
	const referenceAttrSet = attributeData.groupAttributes[ 0 ];
	for ( const key in referenceAttrSet ) {

		const requiredLength = attributeData.getTotalLength( key );
		const type = attributeData.getType( key );
		const itemSize = attributeData.getItemSize( key );
		const normalized = attributeData.getNormalized( key );
		let geoAttr = attributes[ key ];
		if ( ! geoAttr || geoAttr.array.length < requiredLength ) {

			// create the attribute if it doesn't exist yet
			geoAttr = new BufferAttribute( new type( requiredLength ), itemSize, normalized );
			geometry.setAttribute( key, geoAttr );
			needsDisposal = true;

		}

		// assign the data to the geometry attribute buffers in the provided order
		// of the groups list
		let offset = 0;
		for ( let i = 0, l = Math.min( groupOrder.length, attributeData.groupCount ); i < l; i ++ ) {

			const index = groupOrder[ i ].index;
			const { array, type, length } = attributeData.groupAttributes[ index ][ key ];
			const trimmedArray = new type( array.buffer, 0, length );
			geoAttr.array.set( trimmedArray, offset );
			offset += trimmedArray.length;

		}

		geoAttr.needsUpdate = true;
		drawRange = requiredLength / geoAttr.itemSize;

	}

	// remove or update the index appropriately
	if ( geometry.index ) {

		const indexArray = geometry.index.array;
		if ( indexArray.length < drawRange ) {

			geometry.index = null;
			needsDisposal = true;

		} else {

			for ( let i = 0, l = indexArray.length; i < l; i ++ ) {

				indexArray[ i ] = i;

			}

		}

	}

	// initialize the groups
	let groupOffset = 0;
	geometry.clearGroups();
	for ( let i = 0, l = Math.min( groupOrder.length, attributeData.groupCount ); i < l; i ++ ) {

		const { index, materialIndex } = groupOrder[ i ];
		const vertCount = attributeData.getCount( index );
		if ( vertCount !== 0 ) {

			geometry.addGroup( groupOffset, vertCount, materialIndex );
			groupOffset += vertCount;

		}

	}

	// update the draw range
	geometry.setDrawRange( 0, drawRange );

	// remove the bounds tree if it exists because its now out of date
	// TODO: can we have this dispose in the same way that a brush does?
	// TODO: why are half edges and group indices not removed here?
	geometry.boundsTree = null;

	if ( needsDisposal ) {

		geometry.dispose();

	}

}

// Returns the list of materials used for the given set of groups
function getMaterialList( groups, materials ) {

	let result = materials;
	if ( ! Array.isArray( materials ) ) {

		result = [];
		groups.forEach( g => {

			result[ g.materialIndex ] = materials;

		} );

	}

	return result;

}

// Utility class for performing CSG operations
class Evaluator {

	constructor() {

		this.triangleSplitter = new TriangleSplitter();
		this.attributeData = [];
		this.attributes = [ 'position', 'uv', 'normal' ];
		this.useGroups = true;
		this.consolidateGroups = true;
		this.debug = new OperationDebugData();

	}

	getGroupRanges( geometry ) {

		return ! this.useGroups || geometry.groups.length === 0 ?
			[ { start: 0, count: Infinity, materialIndex: 0 } ] :
			geometry.groups.map( group => ( { ...group } ) );

	}

	evaluate( a, b, operations, targetBrushes = new Brush() ) {

		let wasArray = true;
		if ( ! Array.isArray( operations ) ) {

			operations = [ operations ];

		}

		if ( ! Array.isArray( targetBrushes ) ) {

			targetBrushes = [ targetBrushes ];
			wasArray = false;

		}

		if ( targetBrushes.length !== operations.length ) {

			throw new Error( 'Evaluator: operations and target array passed as different sizes.' );

		}

		a.prepareGeometry();
		b.prepareGeometry();

		const {
			triangleSplitter,
			attributeData,
			attributes,
			useGroups,
			consolidateGroups,
			debug,
		} = this;

		// expand the attribute data array to the necessary size
		while ( attributeData.length < targetBrushes.length ) {

			attributeData.push( new TypedAttributeData() );

		}

		// prepare the attribute data buffer information
		targetBrushes.forEach( ( brush, i ) => {

			prepareAttributesData( a.geometry, brush.geometry, attributeData[ i ], attributes );

		} );

		// run the operation to fill the list of attribute data
		debug.init();
		performOperation( a, b, operations, triangleSplitter, attributeData, { useGroups } );
		debug.complete();

		// get the materials and group ranges
		const aGroups = this.getGroupRanges( a.geometry );
		const aMaterials = getMaterialList( aGroups, a.material );

		const bGroups = this.getGroupRanges( b.geometry );
		const bMaterials = getMaterialList( bGroups, b.material );
		bGroups.forEach( g => g.materialIndex += aMaterials.length );

		let groups = [ ...aGroups, ...bGroups ]
			.map( ( group, index ) => ( { ...group, index } ) );

		// generate the minimum set of materials needed for the list of groups and adjust the groups
		// if they're needed
		if ( useGroups ) {

			const allMaterials = [ ...aMaterials, ...bMaterials ];
			if ( consolidateGroups ) {

				groups = groups
					.map( group => {

						const mat = allMaterials[ group.materialIndex ];
						group.materialIndex = allMaterials.indexOf( mat );
						return group;

					} )
					.sort( ( a, b ) => {

						return a.materialIndex - b.materialIndex;

					} );

			}

			// create a map from old to new index and remove materials that aren't used
			const finalMaterials = [];
			for ( let i = 0, l = allMaterials.length; i < l; i ++ ) {

				let foundGroup = false;
				for ( let g = 0, lg = groups.length; g < lg; g ++ ) {

					const group = groups[ g ];
					if ( group.materialIndex === i ) {

						foundGroup = true;
						group.materialIndex = finalMaterials.length;

					}

				}

				if ( foundGroup ) {

					finalMaterials.push( allMaterials[ i ] );

				}

			}

			targetBrushes.forEach( tb => {

				tb.material = finalMaterials;

			} );

		} else {

			groups = [ { start: 0, count: Infinity, index: 0, materialIndex: 0 } ];
			targetBrushes.forEach( tb => {

				tb.material = aMaterials[ 0 ];

			} );

		}

		// apply groups and attribute data to the geometry
		targetBrushes.forEach( ( brush, i ) => {

			const targetGeometry = brush.geometry;
			assignBufferData( targetGeometry, attributeData[ i ], groups );
			if ( consolidateGroups ) {

				joinGroups( targetGeometry.groups );

			}

		} );

		return wasArray ? targetBrushes : targetBrushes[ 0 ];

	}

	// TODO: fix
	evaluateHierarchy( root, target = new Brush() ) {

		root.updateMatrixWorld( true );

		const flatTraverse = ( obj, cb ) => {

			const children = obj.children;
			for ( let i = 0, l = children.length; i < l; i ++ ) {

				const child = children[ i ];
				if ( child.isOperationGroup ) {

					flatTraverse( child, cb );

				} else {

					cb( child );

				}

			}

		};


		const traverse = brush => {

			const children = brush.children;
			let didChange = false;
			for ( let i = 0, l = children.length; i < l; i ++ ) {

				const child = children[ i ];
				didChange = traverse( child ) || didChange;

			}

			const isDirty = brush.isDirty();
			if ( isDirty ) {

				brush.markUpdated();

			}

			if ( didChange && ! brush.isOperationGroup ) {

				let result;
				flatTraverse( brush, child => {

					if ( ! result ) {

						result = this.evaluate( brush, child, child.operation );

					} else {

						result = this.evaluate( result, child, child.operation );

					}

				} );

				brush._cachedGeometry = result.geometry;
				brush._cachedMaterials = result.material;
				return true;

			} else {

				return didChange || isDirty;

			}

		};

		traverse( root );

		target.geometry = root._cachedGeometry;
		target.material = root._cachedMaterials;

		return target;

	}

	reset() {

		this.triangleSplitter.reset();

	}

}

class Operation extends Brush {

	constructor( ...args ) {

		super( ...args );

		this.isOperation = true;
		this.operation = ADDITION;

		this._cachedGeometry = new BufferGeometry();
		this._cachedMaterials = null;
		this._previousOperation = null;

	}

	markUpdated() {

		super.markUpdated();
		this._previousOperation = this.operation;

	}

	isDirty() {

		return this.operation !== this._previousOperation || super.isDirty();

	}

	insertBefore( brush ) {

		const parent = this.parent;
		const index = parent.children.indexOf( this );
		parent.children.splice( index, 0, brush );

	}

	insertAfter( brush ) {

		const parent = this.parent;
		const index = parent.children.indexOf( this );
		parent.children.splice( index + 1, 0, brush );

	}

}

class OperationGroup extends Group {

	constructor() {

		super();
		this.isOperationGroup = true;
		this._previousMatrix = new Matrix4();

	}

	markUpdated() {

		this._previousMatrix.copy( this.matrix );

	}

	isDirty() {

		const { matrix, _previousMatrix } = this;
		const el1 = matrix.elements;
		const el2 = _previousMatrix.elements;
		for ( let i = 0; i < 16; i ++ ) {

			if ( el1[ i ] !== el2[ i ] ) {

				return true;

			}

		}

		return false;

	}

}

function addWorldPosition( shader ) {

	if ( /varying\s+vec3\s+wPosition/.test( shader.vertexShader ) ) return;

	shader.vertexShader = `
			varying vec3 wPosition;
			${shader.vertexShader}
		`.replace(
		/#include <displacementmap_vertex>/,
		v =>
			`${v}
				wPosition = (modelMatrix * vec4( transformed, 1.0 )).xyz;
				`,
	);

	shader.fragmentShader = `
		varying vec3 wPosition;
		${shader.fragmentShader}
		`;

	return shader;

}

function csgGridShaderMixin( shader ) {

	shader.uniforms = {
		...shader.uniforms,
		checkerboardColor: { value: new Color( 0x111111 ) }
	};

	addWorldPosition( shader );

	shader.defines = { CSG_GRID: 1 };

	shader.fragmentShader = shader.fragmentShader.replace(
		/#include <common>/,
		v =>
		/* glsl */`
			${v}

			uniform vec3 checkerboardColor;
			float getCheckerboard( vec2 p, float scale ) {

				p /= scale;
				p += vec2( 0.5 );

				vec2 line = mod( p, 2.0 ) - vec2( 1.0 );
				line = abs( line );

				vec2 pWidth = fwidth( line );
				vec2 value = smoothstep( 0.5 - pWidth / 2.0, 0.5 + pWidth / 2.0, line );
				float result = value.x * value.y + ( 1.0 - value.x ) * ( 1.0 - value.y );

				return result;

			}

			float getGrid( vec2 p, float scale, float thickness ) {

				p /= 0.5 * scale;

				vec2 stride = mod( p, 2.0 ) - vec2( 1.0 );
				stride = abs( stride );

				vec2 pWidth = fwidth( p );
				vec2 line = smoothstep( 1.0 - pWidth / 2.0, 1.0 + pWidth / 2.0, stride + thickness * pWidth );

				return max( line.x, line.y );

			}

			vec3 getFaceColor( vec2 p, vec3 color ) {

				float checkLarge = getCheckerboard( p, 1.0 );
				float checkSmall = abs( getCheckerboard( p, 0.1 ) );
				float lines = getGrid( p, 10.0, 1.0 );

				vec3 checkColor = mix(
					vec3( 0.7 ) * color,
					vec3( 1.0 ) * color,
					checkSmall * 0.4 + checkLarge * 0.6
				);

				vec3 gridColor = vec3( 1.0 );

				return mix( checkColor, gridColor, lines );

			}

			float angleBetween( vec3 a, vec3 b ) {

				return acos( abs( dot( a, b ) ) );

			}

			vec3 planeProject( vec3 norm, vec3 other ) {

				float d = dot( norm, other );
				return normalize( other - norm * d );

			}

			vec3 getBlendFactors( vec3 norm ) {

				vec3 xVec = vec3( 1.0, 0.0, 0.0 );
				vec3 yVec = vec3( 0.0, 1.0, 0.0 );
				vec3 zVec = vec3( 0.0, 0.0, 1.0 );

				vec3 projX = planeProject( xVec, norm );
				vec3 projY = planeProject( yVec, norm );
				vec3 projZ = planeProject( zVec, norm );

				float xAngle = max(
					angleBetween( xVec, projY ),
					angleBetween( xVec, projZ )
				);

				float yAngle = max(
					angleBetween( yVec, projX ),
					angleBetween( yVec, projZ )
				);

				float zAngle = max(
					angleBetween( zVec, projX ),
					angleBetween( zVec, projY )
				);

				return vec3( xAngle, yAngle, zAngle ) / ( 0.5 * PI );

			}
		` ).replace(
		/#include <normal_fragment_maps>/,
		v =>
		/* glsl */`${v}
				#if CSG_GRID
				{

					vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );

					float yCont = abs( dot( vec3( 0.0, 1.0, 0.0 ), worldNormal ) );
					float zCont = abs( dot( vec3( 0.0, 0.0, 1.0 ), worldNormal ) );
					float xCont = abs( dot( vec3( 1.0, 0.0, 0.0 ), worldNormal ) );

					vec3 factors = getBlendFactors( worldNormal );
					factors = smoothstep( vec3( 0.475 ), vec3( 0.525 ), vec3( 1.0 ) - factors );

					float weight = factors.x + factors.y + factors.z;
					factors /= weight;

					vec3 color =
						getFaceColor( wPosition.yz, diffuseColor.rgb ) * factors.x +
						getFaceColor( wPosition.xz, diffuseColor.rgb ) * factors.y +
						getFaceColor( wPosition.xy, diffuseColor.rgb ) * factors.z;

					diffuseColor.rgb = color;

				}
				#endif
				`,
	);

	return shader;

}

class GridMaterial extends MeshPhongMaterial {

	get enableGrid() {

		return Boolean( this._enableGrid );

	}

	set enableGrid( v ) {

		if ( this._enableGrid !== v ) {

			this._enableGrid = v;
			this.needsUpdate = true;

		}

	}

	constructor( ...args ) {

		super( ...args );
		this.enableGrid = true;

	}

	onBeforeCompile( shader ) {

		csgGridShaderMixin( shader );
		shader.defines.CSG_GRID = Number( this.enableGrid );

	}

	customProgramCacheKey() {

		return this.enableGrid.toString();

	}

}

function getTriangleDefinitions( ...triangles ) {

	function getVectorDefinition( v ) {

		return /* js */`new THREE.Vector3( ${ v.x }, ${ v.y }, ${ v.z } )`;

	}

	return triangles.map( t => {

		return /* js */`
new THREE.Triangle(
	${ getVectorDefinition( t.a ) },
	${ getVectorDefinition( t.b ) },
	${ getVectorDefinition( t.c ) },
)
		`.trim();

	} );

}

function logTriangleDefinitions( ...triangles ) {

	console.log( getTriangleDefinitions( ...triangles ).join( ',\n' ) );

}

function generateRandomTriangleColors( geometry ) {

	const position = geometry.attributes.position;
	const array = new Float32Array( position.count * 3 );

	const color = new Color();
	for ( let i = 0, l = array.length; i < l; i += 9 ) {

		color.setHSL(
			Math.random(),
			MathUtils.lerp( 0.5, 1.0, Math.random() ),
			MathUtils.lerp( 0.5, 0.75, Math.random() ),
		);

		array[ i + 0 ] = color.r;
		array[ i + 1 ] = color.g;
		array[ i + 2 ] = color.b;

		array[ i + 3 ] = color.r;
		array[ i + 4 ] = color.g;
		array[ i + 5 ] = color.b;

		array[ i + 6 ] = color.r;
		array[ i + 7 ] = color.g;
		array[ i + 8 ] = color.b;

	}

	geometry.setAttribute( 'color', new BufferAttribute( array, 3 ) );

}

class TriangleSetHelper extends Group {

	get color() {

		return this._mesh.material.color;

	}

	get side() {

		return this._mesh.material.side;

	}

	set side( v ) {

		this._mesh.material.side = v;

	}

	constructor( triangles = [] ) {

		super();

		const geometry = new BufferGeometry();
		const lineGeom = new BufferGeometry();
		this._mesh = new Mesh( geometry, new MeshPhongMaterial( {
			flatShading: true,
			transparent: true,
			opacity: 0.25,
			depthWrite: false,
		} ) );
		this._lines = new LineSegments( lineGeom, new LineBasicMaterial() );
		this._mesh.material.color = this._lines.material.color;

		this._lines.frustumCulled = false;
		this._mesh.frustumCulled = false;

		this.add( this._lines, this._mesh );

		this.setTriangles( triangles );

	}

	setTriangles( triangles ) {

		const triPositions = new Float32Array( 3 * 3 * triangles.length );
		const linePositions = new Float32Array( 6 * 3 * triangles.length );
		for ( let i = 0, l = triangles.length; i < l; i ++ ) {

			const i9 = 9 * i;
			const i18 = 18 * i;
			const tri = triangles[ i ];

			tri.a.toArray( triPositions, i9 + 0 );
			tri.b.toArray( triPositions, i9 + 3 );
			tri.c.toArray( triPositions, i9 + 6 );


			tri.a.toArray( linePositions, i18 + 0 );
			tri.b.toArray( linePositions, i18 + 3 );

			tri.b.toArray( linePositions, i18 + 6 );
			tri.c.toArray( linePositions, i18 + 9 );

			tri.c.toArray( linePositions, i18 + 12 );
			tri.a.toArray( linePositions, i18 + 15 );

		}

		this._mesh.geometry.dispose();
		this._mesh.geometry.setAttribute( 'position', new BufferAttribute( triPositions, 3 ) );

		this._lines.geometry.dispose();
		this._lines.geometry.setAttribute( 'position', new BufferAttribute( linePositions, 3 ) );

	}

}

class EdgesHelper extends LineSegments {

	get color() {

		return this.material.color;

	}

	constructor( edges = [] ) {

		super();
		this.frustumCulled = false;
		this.setEdges( edges );

	}

	setEdges( edges ) {

		const { geometry } = this;
		const points = edges.flatMap( e => [ e.start, e.end ] );
		geometry.dispose();
		geometry.setFromPoints( points );

	}

}

const _matrix = new Matrix4();
class PointsHelper extends InstancedMesh {

	get color() {

		return this.material.color;

	}

	constructor( count = 1000, points = [] ) {

		super( new SphereGeometry( 0.025 ), new MeshBasicMaterial(), count );
		this.frustumCulled = false;
		this.setPoints( points );

	}

	setPoints( points ) {

		for ( let i = 0, l = points.length; i < l; i ++ ) {

			const point = points[ i ];
			_matrix.makeTranslation( point.x, point.y, point.z );
			this.setMatrixAt( i, _matrix );

		}

		this.count = points.length;

	}

}

const vertKeys = [ 'a', 'b', 'c' ];
const _tri1 = new Triangle();
const _tri2 = new Triangle();
const _center = new Vector3();
const _center2 = new Vector3();
const _projected = new Vector3();
const _projected2 = new Vector3();
const _projectedDir = new Vector3();
const _projectedDir2 = new Vector3();
const _edgeDir = new Vector3();
const _edgeDir2 = new Vector3();
const _vec = new Vector3();
const _vec2 = new Vector3();
const _finalPoint = new Vector3();
const _finalPoint2 = new Vector3();
const _plane = new Plane();
const _plane2 = new Plane();
const _centerPoint = new Vector3();
const _ray = new Ray();
const _edge = new Line3();

function getTriangle( geometry, triIndex, target ) {

	const i3 = 3 * triIndex;
	let i0 = i3 + 0;
	let i1 = i3 + 1;
	let i2 = i3 + 2;

	const indexAttr = geometry.index;
	const posAttr = geometry.attributes.position;
	if ( indexAttr ) {

		i0 = indexAttr.getX( i0 );
		i1 = indexAttr.getX( i1 );
		i2 = indexAttr.getX( i2 );

	}

	target.a.fromBufferAttribute( posAttr, i0 );
	target.b.fromBufferAttribute( posAttr, i1 );
	target.c.fromBufferAttribute( posAttr, i2 );

	return target;

}

function getOverlapEdge( tri1, e1, tri2, e2, target ) {

	// get the two edges
	const nextE_0 = ( e1 + 1 ) % 3;
	const v0_1 = tri1[ vertKeys[ e1 ] ];
	const v1_1 = tri1[ vertKeys[ nextE_0 ] ];

	const nextE_1 = ( e2 + 1 ) % 3;
	const v0_2 = tri2[ vertKeys[ e2 ] ];
	const v1_2 = tri2[ vertKeys[ nextE_1 ] ];

	// get the ray defined by the edges
	toNormalizedRay( v0_1, v1_1, _ray );

	// get the min and max stride across the rays
	let d0_1 = _vec.subVectors( v0_1, _ray.origin ).dot( _ray.direction );
	let d1_1 = _vec.subVectors( v1_1, _ray.origin ).dot( _ray.direction );
	if ( d0_1 > d1_1 ) [ d0_1, d1_1 ] = [ d1_1, d0_1 ];

	let d0_2 = _vec.subVectors( v0_2, _ray.origin ).dot( _ray.direction );
	let d1_2 = _vec.subVectors( v1_2, _ray.origin ).dot( _ray.direction );
	if ( d0_2 > d1_2 ) [ d0_2, d1_2 ] = [ d1_2, d0_2 ];

	// get the range of overlap
	const final_0 = Math.max( d0_1, d0_2 );
	const final_1 = Math.min( d1_1, d1_2 );
	_ray.at( final_0, target.start );
	_ray.at( final_1, target.end );

}


class HalfEdgeHelper extends EdgesHelper {

	constructor( geometry = null, halfEdges = null ) {

		super();
		this.straightEdges = false;
		this.displayDisconnectedEdges = false;

		if ( geometry && halfEdges ) {

			this.setHalfEdges( geometry, halfEdges );

		}

	}

	setHalfEdges( geometry, halfEdges ) {

		const { straightEdges, displayDisconnectedEdges } = this;
		const edges = [];
		const offset = geometry.drawRange.start;
		let triCount = getTriCount( geometry );
		if ( geometry.drawRange.count !== Infinity ) {

			triCount = ~ ~ ( geometry.drawRange.count / 3 );

		}

		if ( displayDisconnectedEdges ) {

			if ( halfEdges.unmatchedDisjointEdges ) {

				halfEdges
					.unmatchedDisjointEdges
					.forEach( ( { forward, reverse, ray } ) => {

						[ ...forward, ...reverse ]
							.forEach( ( { start, end } ) => {

								const edge = new Line3();
								ray.at( start, edge.start );
								ray.at( end, edge.end );
								edges.push( edge );

							} );

					} );

			} else {

				for ( let triIndex = offset; triIndex < triCount; triIndex ++ ) {

					getTriangle( geometry, triIndex, _tri1 );
					for ( let e = 0; e < 3; e ++ ) {

						const otherTriIndex = halfEdges.getSiblingTriangleIndex( triIndex, e );
						if ( otherTriIndex === - 1 ) {

							const nextE = ( e + 1 ) % 3;
							const v0 = _tri1[ vertKeys[ e ] ];
							const v1 = _tri1[ vertKeys[ nextE ] ];
							const edge = new Line3();
							edge.start.copy( v0 );
							edge.end.copy( v1 );
							edges.push( edge );

						}

					}

				}

			}

		} else {

			for ( let triIndex = offset; triIndex < triCount; triIndex ++ ) {

				getTriangle( geometry, triIndex, _tri1 );
				for ( let e = 0; e < 3; e ++ ) {

					const otherTriIndex = halfEdges.getSiblingTriangleIndex( triIndex, e );
					if ( otherTriIndex === - 1 ) {

						continue;

					}

					// get other triangle
					getTriangle( geometry, otherTriIndex, _tri2 );

					// get edge centers
					const nextE = ( e + 1 ) % 3;
					const v0 = _tri1[ vertKeys[ e ] ];
					const v1 = _tri1[ vertKeys[ nextE ] ];
					_centerPoint.lerpVectors( v0, v1, 0.5 );
					addConnectionEdge( _tri1, _tri2, _centerPoint );

				}

				if ( halfEdges.disjointConnections ) {

					for ( let e = 0; e < 3; e ++ ) {

						const disjointTriIndices = halfEdges.getDisjointSiblingTriangleIndices( triIndex, e );
						const disjointEdgeIndices = halfEdges.getDisjointSiblingEdgeIndices( triIndex, e );

						for ( let i = 0; i < disjointTriIndices.length; i ++ ) {

							const ti = disjointTriIndices[ i ];
							const ei = disjointEdgeIndices[ i ];

							// get other triangle
							getTriangle( geometry, ti, _tri2 );

							getOverlapEdge( _tri1, e, _tri2, ei, _edge );

							_centerPoint.lerpVectors( _edge.start, _edge.end, 0.5 );
							addConnectionEdge( _tri1, _tri2, _centerPoint );

						}

					}

				}

			}

		}

		super.setEdges( edges );

		function addConnectionEdge( tri1, tri2, centerPoint ) {

			tri1.getMidpoint( _center );
			tri2.getMidpoint( _center2 );

			tri1.getPlane( _plane );
			tri2.getPlane( _plane2 );

			const edge = new Line3();
			edge.start.copy( _center );

			if ( straightEdges ) {

				// get the projected centers
				_plane.projectPoint( _center2, _projected );
				_plane2.projectPoint( _center, _projected2 );

				// get the directions so we can flip them if needed
				_projectedDir.subVectors( _projected, _center );
				_projectedDir2.subVectors( _projected2, _center2 );

				// get the directions so we can flip them if needed
				_edgeDir.subVectors( centerPoint, _center );
				_edgeDir2.subVectors( centerPoint, _center2 );

				if ( _projectedDir.dot( _edgeDir ) < 0 ) {

					_projectedDir.multiplyScalar( - 1 );

				}

				if ( _projectedDir2.dot( _edgeDir2 ) < 0 ) {

					_projectedDir2.multiplyScalar( - 1 );

				}

				// find the new points after inversion
				_vec.addVectors( _center, _projectedDir );
				_vec2.addVectors( _center2, _projectedDir2 );

				// project the points onto the triangle edge. This would be better
				// if we clipped instead of chose the closest point
				tri1.closestPointToPoint( _vec, _finalPoint );
				tri2.closestPointToPoint( _vec2, _finalPoint2 );

				edge.end.lerpVectors( _finalPoint, _finalPoint2, 0.5 );

			} else {

				edge.end.copy( centerPoint );

			}

			edges.push( edge );

		}

	}

}

// https://stackoverflow.com/questions/1406029/how-to-calculate-the-volume-of-a-3d-mesh-object-the-surface-of-which-is-made-up
const _tri = new Triangle();
const _normal = new Vector3();
const _relPoint = new Vector3();
function computeMeshVolume( mesh ) {

	// grab the matrix and the geometry
	let geometry;
	let matrix;
	if ( mesh.isBufferGeometry ) {

		geometry = mesh;
		matrix = null;

	} else {

		geometry = mesh.geometry;
		matrix = Math.abs( mesh.matrixWorld.determinant() - 1.0 ) < 1e-15 ? null : mesh.matrixWorld;

	}

	// determine the number of relevant draw range elements to use
	const index = geometry.index;
	const pos = geometry.attributes.position;
	const drawRange = geometry.drawRange;
	const triCount = Math.min( getTriCount( geometry ), drawRange.count / 3 );

	// get a point relative to the position of the geometry to avoid floating point error
	_tri.setFromAttributeAndIndices( pos, 0, 1, 2 );
	applyMatrix4ToTri( _tri, matrix );
	_tri.getNormal( _normal );
	_tri.getMidpoint( _relPoint ).add( _normal );

	// iterate over all triangles
	let volume = 0;
	const startIndex = drawRange.start / 3;
	for ( let i = startIndex, l = startIndex + triCount; i < l; i ++ ) {

		let i0 = 3 * i + 0;
		let i1 = 3 * i + 1;
		let i2 = 3 * i + 2;
		if ( index ) {

			i0 = index.getX( i0 );
			i1 = index.getX( i1 );
			i2 = index.getX( i2 );

		}

		// get the triangle
		_tri.setFromAttributeAndIndices( pos, i0, i1, i2 );
		applyMatrix4ToTri( _tri, matrix );
		subVectorFromTri( _tri, _relPoint );

		// add the signed volume
		volume += signedVolumeOfTriangle( _tri.a, _tri.b, _tri.c );

	}

	return Math.abs( volume );

}

function signedVolumeOfTriangle( p1, p2, p3 ) {

	const v321 = p3.x * p2.y * p1.z;
	const v231 = p2.x * p3.y * p1.z;
	const v312 = p3.x * p1.y * p2.z;
	const v132 = p1.x * p3.y * p2.z;
	const v213 = p2.x * p1.y * p3.z;
	const v123 = p1.x * p2.y * p3.z;
	return ( 1 / 6 ) * ( - v321 + v231 + v312 - v132 - v213 + v123 );

}

function subVectorFromTri( tri, pos ) {

	tri.a.sub( pos );
	tri.b.sub( pos );
	tri.c.sub( pos );

}

function applyMatrix4ToTri( tri, mat = null ) {

	if ( mat !== null ) {

		tri.a.applyMatrix4( mat );
		tri.b.applyMatrix4( mat );
		tri.c.applyMatrix4( mat );

	}

}

export { ADDITION, Brush, DIFFERENCE, EdgesHelper, Evaluator, GridMaterial, HOLLOW_INTERSECTION, HOLLOW_SUBTRACTION, HalfEdgeHelper, HalfEdgeMap, INTERSECTION, Operation, OperationGroup, PointsHelper, REVERSE_SUBTRACTION, SUBTRACTION, TriangleSetHelper, TriangleSplitter, computeMeshVolume, generateRandomTriangleColors, getTriangleDefinitions, logTriangleDefinitions };
//# sourceMappingURL=index.module.js.map
