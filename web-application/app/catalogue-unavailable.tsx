/**
 * Shown when a catalogue read fails at request time because the API is
 * unreachable.
 *
 * Deliberately not a 404: a product that exists must not be reported as missing
 * just because the catalogue is briefly down. The page that renders this also
 * opts out of static caching, so the failure is never baked into the ISR cache.
 */
export function CatalogueUnavailable() {
  return (
    <p className="p-6 text-muted">
      The catalogue is temporarily unavailable. Please try again in a moment.
    </p>
  )
}
