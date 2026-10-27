# API map: sample-backend

Each row is one endpoint. `scripts/api-map.mjs` fails when this table and `src/routes.js` disagree.

| Method | Path | Handler | Calls | Owner |
| --- | --- | --- | --- | --- |
| GET | /health | src/routes.js | none | platform |
| GET | /items | src/modules/items/controller.js | items/service.getItems → items/repository.listItems → table items | items |
| POST | /items | src/modules/items/controller.js | items/service.createItem → items/repository.insertItem → table items | items |
| GET | /reports/summary | src/modules/reports/controller.js | items/repository.listItems (legacy boundary violation, in guard baseline) | reports |
