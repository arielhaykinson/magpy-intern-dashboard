# Magpy Intern Dashboard

Shared task list, calendar, board and hours tracker for the Magpy interns. Several people can edit at once; changes sync live and are saved to a JSON file. No dependencies beyond Node.js.

## Run
    node server.js
Then open http://localhost:8765

## Config (env vars)
- `PORT` (default `8765`)
- `DATA_DIR` (default `./data`) – data is stored in `$DATA_DIR/db.json`, with backups in `$DATA_DIR/backups/` every 10 minutes (newest 48 kept).

## Deploy
- Render: `render.yaml` blueprint (Node web service + persistent disk at `/data`).
- Docker: `docker build -t magpy . && docker run -p 8765:8765 -v magpy-data:/data magpy`

Note: there is no login yet; anyone with the URL can edit.
