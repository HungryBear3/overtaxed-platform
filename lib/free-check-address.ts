export function normalizeFreeCheckSearchInput(address: string, city: string = "") {
  let searchAddress = address.trim().replace(/\s+/g, " ")
  let searchCity = city.trim().replace(/\s+/g, " ")

  if (searchAddress.includes(",")) {
    const [street, ...rest] = searchAddress.split(",").map((part) => part.trim()).filter(Boolean)
    searchAddress = street || searchAddress
    if (!searchCity && rest.length > 0) {
      searchCity = rest.join(" ")
        .replace(/\b(?:IL|Illinois)\b\.?/gi, " ")
        .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    }
  }

  searchAddress = searchAddress
    .replace(/\b(?:IL|Illinois)\b\.?/gi, " ")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  if (!searchCity) {
    const chicagoSuffix = searchAddress.match(/^(.*)\s+Chicago$/i)
    if (chicagoSuffix?.[1]) {
      searchAddress = chicagoSuffix[1].trim()
      searchCity = "Chicago"
    }
  }

  return { address: searchAddress, city: searchCity }
}
