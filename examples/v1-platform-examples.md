# BrowseAPI v1 Platform Examples

## Run a Flight Search Task

```bash
curl -X POST http://localhost:3000/v1/travel/flights/search \
  -H "Content-Type: application/json" \
  -H "x-project-id: demo" \
  -d '{
    "origin": "Bengaluru",
    "destination": "Delhi",
    "departDate": "2026-05-15",
    "tripType": "one-way",
    "passengers": 1,
    "cabin": "economy",
    "preference": "cheapest good deal"
  }'
```

## Search Hotels Under a Budget

```bash
curl -X POST http://localhost:3000/v1/travel/hotels/search \
  -H "Content-Type: application/json" \
  -d '{
    "destination": "Wayanad, Kerala",
    "dates": { "checkin": "2026-05-09", "checkout": "2026-05-10" },
    "budgetMax": 5000,
    "currency": "INR"
  }'
```

## Extract Page Data

```bash
curl -X POST http://localhost:3000/v1/extract \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "schema": { "title": "main page title" },
    "maxElements": 50
  }'
```

## Fill a Form Draft

```bash
curl -X POST http://localhost:3000/v1/forms/fill \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://the-internet.herokuapp.com/login",
    "fields": [
      { "description": "username input", "value": "tomsmith" },
      { "description": "password input", "value": "SuperSecretPassword!" }
    ]
  }'
```

## Inspect Task Events and Artifacts

```bash
curl http://localhost:3000/v1/tasks/TASK_ID/events
curl http://localhost:3000/v1/tasks/TASK_ID/artifacts
```

