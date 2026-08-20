# Entrypoints

Single-container entrypoints that combine all services into one process.

## Status

Planned — not yet implemented.

## Planned entrypoints

- `entrypoints/single.js` — starts API + worker + nginx in one container
- `entrypoints/dev.js` — starts all services in development mode with hot reload

## Usage

```dockerfile
CMD ["node", "entrypoints/single.js"]
```
