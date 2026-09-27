\# al-core: local dev setup



\## Prerequisites

\- Node.js 22+

\- `npm install -g firebase-tools`



\## Start the emulators



From `al-core/`:



```

firebase emulators:start --project demo-al --import=./seed-data

```



Emulator UI: http://127.0.0.1:4000



\## Seeded users



Password for all: `password123`



| Email | Role |

|---|---|

| alice@test.com | borrower |

| bob@test.com | broker |

| uma@test.com | underwriter |



\## Connect from your dev build



| Platform | Auth | Firestore |

|---|---|---|

| Web | `localhost:9099` | `localhost:8080` |

| iOS Simulator | `localhost:9099` | `localhost:8080` |

| Android Emulator | `10.0.2.2:9099` | `10.0.2.2:8080` |



\## Re-seeding



If you change the schema or seed data, regenerate the export:



```

firebase emulators:start --project demo-al

node scripts/seed.js

firebase emulators:export ./seed-data --project demo-al --force

```



\## Running the rules tests



```

npm install

npx jest

```



Requires the emulator (above) running in a separate terminal on port 8080.

