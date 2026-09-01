# Studio Gestión

Sistema web para gestión de clases de una profesora.

## Estado actual

- **Backend:** Etapa 1 - Foundation
- **Frontend:** NOT STARTED

## Stack

- Node.js, NestJS, TypeScript, Prisma, PostgreSQL
- Vue 3 (pendiente)

## Requisitos

- Node.js >= 20
- npm >= 10
- Docker y Docker Compose

## Cómo empezar

Instalar dependencias:

```bash
npm install
```

Levantar PostgreSQL:

```bash
docker compose up -d
```

Ejecutar migraciones Prisma:

```bash
npm run prisma:migrate
```

Iniciar backend en desarrollo:

```bash
npm run dev:backend
```

Ver documentación de API: http://localhost:3000/api/docs
```
