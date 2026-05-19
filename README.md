# NCDC IT Issue Resolution Management System

Developed by Group 17 - Makerere University © 2026

This is a complete Node.js, Express and PostgreSQL system for reporting, assigning, updating and tracking IT issues.

## Main Features

- Role-based login: Admin, Manager, IT Staff and User
- All roles can report issues
- Manager/Admin can assign issues to IT Staff
- IT Staff and allowed users can update issue progress
- PostgreSQL online database support
- Persistent data storage using DATABASE_URL
- Professional dashboards and live charts
- User management
- Issue update refresh button
- Notifications with short message-style sound
- Professional footer inside the logged-in system only
- No SQLite dependency for online deployment

## Demo Accounts

Use these after first deployment:

```txt
Admin: admin@ncdc.local / Admin@123
Manager: manager@ncdc.local / Manager@123
IT Staff: staff@ncdc.local / Staff@123
User: user@ncdc.local / User@123
```

## Local Setup

You need PostgreSQL installed locally or an online PostgreSQL database URL.

1. Copy `.env.example` to `.env`
2. Add your PostgreSQL connection string:

```txt
DATABASE_URL=your_postgresql_url
SESSION_SECRET=your_long_secret
NODE_ENV=development
PORT=3000
```

3. Install dependencies:

```bash
npm install
```

4. Start the system:

```bash
npm start
```

5. Open:

```txt
http://localhost:3000
```

## Railway Deployment

1. Upload these files to GitHub:

```txt
server.js
package.json
public/
README.md
railway.json
.env.example
Procfile
render.yaml
```

2. Do not upload:

```txt
node_modules/
.env
*.zip
```

3. On Railway, create a new project from GitHub.
4. Add PostgreSQL database.
5. In your web service variables, add:

```txt
DATABASE_URL=${{Postgres.DATABASE_URL}}
SESSION_SECRET=ncdc_group17_secure_session_2026
NODE_ENV=production
```

6. Build command:

```txt
npm install
```

7. Start command:

```txt
npm start
```

## Important

Submitted data is stored in PostgreSQL. It will remain available unless deleted from the database.
