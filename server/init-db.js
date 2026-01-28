const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function initDB() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'wod123',
  };

  try {
    // 1. Connect without database selected
    console.log('Connecting to MySQL...');
    const connection = await mysql.createConnection(config);
    console.log('Connected.');

    // 2. Read schema.sql
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // 3. Execute statements
    const statements = schema
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      console.log(`Executing: ${statement.substring(0, 50)}...`);
      await connection.query(statement);
    }

    console.log('Database initialized successfully!');
    await connection.end();
  } catch (err) {
    console.error('Failed to initialize database:', err.message);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\nPlease check your MySQL password in server/db.js or .env file.');
    }
    process.exit(1);
  }
}

initDB();