const dotenv = require('dotenv');
dotenv.config();

const knexLib = require('knex');
const knexfile = require('../knexfile');

const env = process.env.NODE_ENV || 'development';
const config = knexfile[env];

const knex = knexLib(config);

module.exports = knex;
