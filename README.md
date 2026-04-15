# Nuqta Plus (نقطة بلس)

Nuqta Plus is a comprehensive Point of Sale (POS) and Inventory Management System designed to streamline business operations. Built with modern web technologies and wrapped in Electron for a seamless desktop experience.

## 🚀 Features

- **Point of Sale (POS)**: Efficient sales processing with barcode support.
- **Inventory Management**: Track stock levels, categories, and products.
- **Installment Management**: Handle customer installments and payments.
- **Reporting**: Visual analytics using ApexCharts for sales and performance tracking.
- **Receipt Printing**: Support for thermal printers.
- **Multi-user Support**: Role-based access control.

## 🛠 Tech Stack

**Frontend:**

- **Framework**: Vue 3
- **Build Tool**: Vite
- **UI Component Library**: Vuetify
- **State Management**: Pinia
- **Desktop Wrapper**: Electron

**Backend:**

- **Runtime**: Node.js
- **Framework**: Fastify
- **Database**: SQLite (via Better-SQLite3)
- **ORM**: Drizzle ORM
- **Authentication**: JWT

## 📋 Prerequisites

- **Node.js**: >= 20.0.0
- **pnpm**: >= 9.0.0

## 📦 Installation

1.  **Clone the repository:**

    ```bash
    git clone <repository-url>
    cd nuqta
    ```

2.  **Install dependencies:**
    This project uses a monorepo-like structure. You can install dependencies from the root:
    ```bash
    pnpm install -r
    ```
    Or individually in `backend` and `frontend` directories.

## 💻 Development

To start the development environment (Backend + Frontend + Electron):

```bash
pnpm dev
```

This command runs:

- Backend server (watching for changes)
- Frontend Dev Server
- Electron window

If you want to run the frontend in a web browser only (without Electron):

```bash
pnpm dev:web
```

## 🗄️ Database Setup

The project uses Drizzle ORM with SQLite.

1.  **Generate Migrations:**

    ```bash
    pnpm db:generate
    ```

2.  **Run Migrations:**

    ```bash
    pnpm db:migrate
    ```

3.  **Seed Data (Optional):**
    ```bash
    pnpm seed
    ```

## 🏗 Building

To build the application for production (Windows):

```bash
pnpm build
```

This will:

1. Build the backend.
2. Build the frontend.
3. Package the application using `electron-builder`.

The output will be in the `release` or `frontend/dist-electron` directory depending on configuration.

## 📄 License

**Proprietary**. All rights reserved to the Nuqta Plus Team.
