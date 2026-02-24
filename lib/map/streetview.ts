/**
 * Street View helpers to orient the camera toward the building (front-facing view).
 * Uses Street View Metadata API to get the panorama position, then computes heading
 * from the camera (on the street) toward the building.
 */

/**
 * Compute bearing/heading in degrees (0-360) from point A to point B.
 * Matches Google Maps Geometry spherical.computeHeading(from, to).
 */
export function computeBearing(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number
): number {
  const fromLatRad = (fromLat * Math.PI) / 180
  const toLatRad = (toLat * Math.PI) / 180
  const dLng = ((toLng - fromLng) * Math.PI) / 180
  const x = Math.sin(dLng) * Math.cos(toLatRad)
  const y =
    Math.cos(fromLatRad) * Math.sin(toLatRad) -
    Math.sin(fromLatRad) * Math.cos(toLatRad) * Math.cos(dLng)
  const heading = (Math.atan2(x, y) * 180) / Math.PI
  return ((heading % 360) + 360) % 360
}

/**
 * Fetch Street View metadata for a location. Returns the panorama's actual position
 * (where the camera is on the street), or null if no imagery exists.
 */
export async function getStreetViewMetadata(
  lat: number,
  lng: number,
  apiKey: string
): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${apiKey}`
  const res = await fetch(url, { next: { revalidate: 0 } })
  if (!res.ok) return null
  const data = await res.json()
  if (data.status !== "OK" || !data.location) return null
  return { lat: data.location.lat, lng: data.location.lng }
}

/**
 * Compute the heading to use so the Street View camera faces the building.
 * Fetches metadata to get the panorama (camera) position, then returns the bearing
 * from camera toward the building. Returns null if metadata is unavailable.
 */
export async function getHeadingTowardBuilding(
  buildingLat: number,
  buildingLng: number,
  apiKey: string
): Promise<number | null> {
  const pano = await getStreetViewMetadata(buildingLat, buildingLng, apiKey)
  if (!pano) return null
  return computeBearing(pano.lat, pano.lng, buildingLat, buildingLng)
}
