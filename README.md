# Banking System Backend

## Prerequisites

Before running the application, install:

- [Node.js](https://nodejs.org/)
- npm, included with Node.js
- A MongoDB database, such as [MongoDB Atlas](https://www.mongodb.com/atlas)

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Mga-Pots/banking-system-backend.git
cd banking-system-backend
```

### 2. Switch to the development branch

```bash
git switch dev
git pull origin dev
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root. Use `.env.example` as the reference for the required variables.

Configure the following values:

| Variable         | Purpose                               |
| ---------------- | ------------------------------------- |
| `DB_USER`        | MongoDB username                      |
| `DB_PASS`        | MongoDB password                      |
| `DB_HOST`        | MongoDB cluster hostname              |
| `DB_NAME`        | Database name                         |
| `JWT_SECRET`     | Secret used to sign JWTs              |
| `JWT_EXPIRES_IN` | JWT expiration duration               |
| `PORT`           | Backend server port                   |
| `CLIENT_URL`     | Allowed frontend origin               |
| `ADMIN_EMAIL`    | Email for the seeded administrator    |
| `ADMIN_PASSWORD` | Password for the seeded administrator |

Use the exact variable names and configuration format in `.env.example`. Keep `.env` out of version control, and never commit real credentials or secrets.

### 5. Start the development server

```bash
npm run dev
```

To start the server without development watch mode:

```bash
npm start
```

The default port in the server configuration is `5001` when `PORT` is not configured.

### 6. Verify the server

Send a `GET` request to:

```http
http://localhost:5001/api/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

## Administrator Setup

Create the administrator account using the configured environment variables:

```bash
npm run seed:admin
```

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env` before running the seed script. Use the administrator credentials to log in and obtain a JWT for staff/admin operations.

## API Documentation

Base URL for local development:

```text
http://localhost:5001/api
```

Protected endpoints require a valid JWT in the request header:

```http
Authorization: Bearer <your_jwt_token>
```

### Authentication — `/api/auth`

| Method | Endpoint    | Access        | Description                                       |
| ------ | ----------- | ------------- | ------------------------------------------------- |
| `POST` | `/register` | Public        | Register a customer                               |
| `POST` | `/login`    | Public        | Authenticate a user                               |
| `GET`  | `/me`       | Authenticated | Retrieve the current user's profile               |
| `POST` | `/logout`   | Authenticated | Confirm logout; the client must discard its token |

Registration requires `name`, `email`, and `password`. The password must contain at least eight characters. `contactNumber` is optional.

### Bank Accounts — `/api/accounts`

| Method  | Endpoint                 | Access                 | Description                                  |
| ------- | ------------------------ | ---------------------- | -------------------------------------------- |
| `GET`   | `/me`                    | Customer               | Retrieve the current customer's bank account |
| `GET`   | `/me/balance`            | Customer               | Retrieve account number, balance, and status |
| `GET`   | `/lookup/:accountNumber` | Customer               | Look up an eligible recipient account        |
| `GET`   | `/:id`                   | Customer, staff, admin | Retrieve account details                     |
| `PATCH` | `/:id/freeze`            | Staff, admin           | Freeze a bank account                        |
| `PATCH` | `/:id/unfreeze`          | Staff, admin           | Reactivate a frozen bank account             |

Account lookup and account detail retrieval have additional validation and access restrictions. Customers can only retrieve their own account details through the account ID endpoint.

To freeze an account, provide a reason in the JSON request body:

```json
{
  "reason": "Testing account freeze functionality"
}
```

### Transactions — `/api/transactions`

| Method  | Endpoint      | Access                 | Description                         |
| ------- | ------------- | ---------------------- | ----------------------------------- |
| `POST`  | `/cash-in`    | Customer               | Add funds to the customer's account |
| `POST`  | `/transfer`   | Customer               | Transfer funds to another account   |
| `GET`   | `/`           | Customer               | Retrieve transaction history        |
| `GET`   | `/:id`        | Customer, staff, admin | Retrieve transaction details        |
| `PATCH` | `/:id/cancel` | Customer               | Cancel an eligible pending transfer |

Amounts are represented as positive integer centavos. For example, ₱100.00 is sent as `10000`.

Cash-in requests are limited to ₱50,000 per transaction. Transfers of ₱50,000 or more are held for staff review rather than completed immediately. Eligible pending transfers can be cancelled by their sender.

## Transaction Statuses

Transactions can have the following statuses:

| Status      | Description                   |
| ----------- | ----------------------------- |
| `pending`   | Awaiting completion or review |
| `completed` | Successfully completed        |
| `failed`    | Failed transaction            |
| `cancelled` | Cancelled transaction         |
| `flagged`   | Marked for review             |

A transfer held for review debits the sender immediately, while the recipient is credited only when the transfer completes. Cancelling an eligible pending transfer restores the sender's funds.

## Error Responses

API errors generally follow this structure:

```json
{
  "success": false,
  "message": "Error description"
}
```

Common HTTP status codes include:

- `400 Bad Request` — Invalid input or an invalid operation
- `401 Unauthorized` — Missing, invalid, or expired authentication token
- `403 Forbidden` — Insufficient permissions or an unavailable account
- `404 Not Found` — Requested resource does not exist
- `409 Conflict` — Duplicate registration details
- `429 Too Many Requests` — Login attempts exceeded the allowed limit
- `500 Internal Server Error` — Unexpected server-side error

## Available Scripts

| Command              | Description                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`        | Start the development server with Node.js watch mode                                         |
| `npm start`          | Start the server                                                                             |
| `npm run seed:admin` | Run the administrator seed script                                                            |
| `npm test`           | Test script is currently a placeholder; automated tests are not configured in `package.json` |

## Development Status

This project is under active development. The documented features reflect the current backend implementation and may change as additional functionality is developed.

