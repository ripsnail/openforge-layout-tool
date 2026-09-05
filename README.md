# OpenForge Layout Tool

A browser-based 3D layout tool for arranging OpenForge STL models, saving layouts, and exporting them for later use.

## Recommended setup: Docker

Docker is the recommended way to run the project because it provides the expected Node.js runtime and keeps the development environment consistent.

### Requirements

- Docker Engine with Compose support
- A modern browser with WebGL support
- Network access to the configured OpenForge catalog endpoints when browsing or downloading catalog models

### Start the application

From the project directory, run:

```sh
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173) in a browser.

The Compose configuration mounts the source files for development and keeps downloaded STL files in the project’s `downloaded/` directory. Stop the application with:

```sh
docker compose down
```

### Configure catalog endpoints

Compose uses these defaults:

- Catalog API: `https://staging.openforge.tools`
- Catalog objects: `https://objects.openforge.tools`

Override them with environment variables when starting Compose:

```sh
OPENFORGE_CATALOG_API_URL=https://catalog.example.com \\
OPENFORGE_CATALOG_OBJECTS_URL=https://objects.example.com \\
docker compose up --build
```

You can also put the variables in a `.env` file beside `docker-compose.yml`; Compose automatically reads that file:

```dotenv
OPENFORGE_CATALOG_API_URL=https://staging.openforge.tools
OPENFORGE_CATALOG_OBJECTS_URL=https://objects.openforge.tools
```

## Alternative setup: local Node.js

A local installation is available if Docker is not suitable.

### Requirements

- Node.js 24 or newer
- npm
- A modern browser with WebGL support
- Network access to the configured catalog endpoints
- Write access to the project’s `downloaded/` directory, which stores locally downloaded models and metadata

Node.js 24 is recommended because the development server uses Node’s built-in SQLite support for downloaded-model metadata.

### Install and run

```sh
npm ci
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in a browser. The development server is bound to the host interface by the `--host` option.

Set catalog endpoints before starting the server if needed:

```sh
OPENFORGE_CATALOG_API_URL=https://catalog.example.com \\
OPENFORGE_CATALOG_OBJECTS_URL=https://objects.example.com \\
npm run dev
```

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Create a production build in `dist/`. |
| `npm run preview` | Preview the production build locally. |
| `npm run lint` | Run ESLint across the project. |
| `npm run audit` | Check dependencies for moderate-or-higher vulnerabilities. |

## Using the application

1. Start the application using Docker or the local Node.js setup.
2. Use the model palette to browse and select catalog models.
3. Choose **Place** and click in the viewport to add models.
4. Use the file tabs to work with multiple layouts.
5. Use **File → Save Layout** to export a layout as JSON.
6. Use **File → Load Layout** to restore an exported layout.
7. Use **Templates** to place built-in templates or save the current selection.

Downloaded models and layout metadata are cached locally. The `downloaded/` directory may contain STL files, thumbnails, and the metadata database after the application has been used.

## Project configuration

- `docker-compose.yml` defines the recommended development container and catalog endpoint overrides.
- `Dockerfile` builds the Node.js development image.
- `vite.config.js` provides the development server, catalog proxy, and downloaded-model storage endpoints.
- `src/` contains the browser application.
- `server/` contains server-side path and cache helpers.
- `downloaded/` is runtime storage and should remain writable when running the application.

The development server includes request validation, path traversal protection, request-size limits, and same-origin checks for state-changing local cache operations. It is intended for development and trusted local-network use; put a separately configured production server or reverse proxy in front of it for production hosting.

## Troubleshooting

### Port 5173 is already in use

Stop the process using port 5173, or run the application with a different Vite configuration/port.

### Models do not load

Check that:

- The browser supports WebGL.
- The catalog endpoint variables point to reachable services.
- The container or local process can write to `downloaded/`.
- The browser console and in-app notifications do not report a failed model or catalog request.

### Docker changes are not appearing

Rebuild the image after dependency or Dockerfile changes:

```sh
docker compose up --build
```

Source files are mounted into the container, so normal files under `src/`, `public/`, and `index.html` are available without rebuilding the image.
