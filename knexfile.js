// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
require('dotenv').config();

/**
 * Knex configuration.
 * Uses MySQL (`mysql2`) for `development` by reading from environment variables.
 * Keep other environments available for future use.
 */
module.exports = {
  development: {
    client: 'mysql2',
    connection: {
      host: process.env.DB_HOST || '127.0.0.1',
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
      user: process.env.DB_USER || 'tle_user',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'tle_db',
      timezone: 'UTC'
    },
    pool: { min: 0, max: 10 },
    migrations: {
      directory: './migrations',
      tableName: 'knex_migrations'
    }
  },

  staging: {
    client: 'postgresql',
    connection: {
      database: process.env.DB_NAME || 'my_db',
      user: process.env.DB_USER || 'username',
      password: process.env.DB_PASSWORD || 'password'
    },
    pool: { min: 2, max: 10 },
    migrations: { tableName: 'knex_migrations' }
  },

  production: {
    client: 'postgresql',
    connection: {
      database: process.env.DB_NAME || 'my_db',
      user: process.env.DB_USER || 'username',
      password: process.env.DB_PASSWORD || 'password'
    },
    pool: { min: 2, max: 10 },
    migrations: { tableName: 'knex_migrations' }
  }
};
