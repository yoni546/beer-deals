# israel-geolocation 🇮🇱

Complete geolocation data for all Israeli cities, towns, and villages with Hebrew and English names.

**1,264 locations** with 98% coverage of Israel's official settlements.

## Features

- ✅ **1,264 locations** from Israeli government data
- ✅ **Hebrew + English names** for every location
- ✅ **Precise coordinates** (latitude/longitude)
- ✅ **TypeScript** with full type definitions
- ✅ **Zero dependencies** - works offline
- ✅ **Ultra-lean** - 212KB package size
- ✅ **Tree-shakeable** ES modules

## Installation

```bash
npm install israel-geolocation
```

## Quick Start

```javascript
import { locations, getById, searchByName } from 'israel-geolocation';

// Get all locations
console.log(locations.length); // 1,264

// Get by ID
const telAviv = getById('5000');
console.log(telAviv);
// { id: '5000', name: 'תל אביב - יפו', nameEn: 'TEL AVIV - YAFO', lat: 32.085, lon: 34.782 }

// Search by name
const results = searchByName('ירושלים');  // Hebrew
const results = searchByName('Jerusalem', 'en');  // English
```

## API

### `locations: Location[]`
Array of all 1,264 locations.

### `getById(id: string | number): Location | undefined`
Get a location by its settlement code.

```javascript
const location = getById('3000'); // Jerusalem
```

### `getByName(name: string): Location[]`
Get locations by exact name match (Hebrew or English).

```javascript
const results = getByName('תל אביב - יפו');
```

### `searchByName(query: string, lang?: 'en' | 'he' | 'both'): Location[]`
Search locations by partial name match. Default: `'both'`

```javascript
const results = searchByName('Tel', 'en');
// Returns: Tel Aviv, Tel Mond, Tel Adashim, etc.
```

### `findNearest(lat: number, lon: number, limit?: number): Location[]`
Find nearest locations to coordinates. Default limit: `10`

```javascript
const nearby = findNearest(32.0853, 34.7818, 5);
```

## Location Object

```typescript
interface Location {
  id: string | number;    // Settlement code
  name: string | null;    // Hebrew name
  nameEn: string | null;  // English name
  lat: number;            // Latitude
  lon: number;            // Longitude
}
```

## TypeScript

Full TypeScript support included:

```typescript
import { Location } from 'israel-geolocation';

const city: Location = {
  id: '5000',
  name: 'תל אביב - יפו',
  nameEn: 'TEL AVIV - YAFO',
  lat: 32.0853,
  lon: 34.7818
};
```

## React + Leaflet Example

```jsx
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import { locations } from 'israel-geolocation';

function IsraelMap() {
  return (
    <MapContainer center={[31.5, 34.75]} zoom={8} style={{ height: '600px' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {locations.map(loc => (
        <Marker key={loc.id} position={[loc.lat, loc.lon]}>
          <Popup>{loc.nameEn || loc.name}</Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
```

## Data Sources

- **Israeli Government** ([data.gov.il](https://data.gov.il)) - Official settlement list
- **OpenStreetMap** - 935 coordinates (ODbL license)
- **Google Maps Geocoding** - 331 additional coordinates

**Coverage**: 1,264 out of 1,289 official settlements (98%). Excluded: 21 Bedouin tribes, 2 military camps, 1 failed geocoding, 1 placeholder entry.

## Package Size

- Total: **212KB**
- Data: **194KB** (locations.json)
- Code: **1.9KB** (minified)

## License

MIT

Data sources:
- Israeli Government Open Data (data.gov.il)
- OpenStreetMap © OpenStreetMap contributors (ODbL)
- Google Maps Geocoding API

## Contributing

Issues and PRs welcome!

**Automated Updates**: GitHub Action runs weekly to detect new settlements from government data.
