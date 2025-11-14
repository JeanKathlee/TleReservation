/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
	return knex.schema
		.createTable('users', function(t) {
			t.increments('id').primary();
			t.string('username').notNullable().unique();
			t.string('password').notNullable();
			t.string('role').notNullable().defaultTo('user');
		})
		.then(() => {
			return knex.schema.createTable('reservations', function(t) {
				t.increments('id').primary();
				t.string('venue').notNullable();
				t.date('date').notNullable();
				t.string('time_from');
				t.string('time_to');
				t.text('purpose');
				t.text('equipment');
				t.string('person_name');
				t.string('person_signature');
				t.integer('created_by').unsigned().references('id').inTable('users').onDelete('SET NULL');
				t.string('status').notNullable().defaultTo('pending');
				t.timestamp('created_at').defaultTo(knex.fn.now());
			});
		})
		.then(() => {
			return knex.schema.createTable('reservation_items', function(t) {
				t.increments('id').primary();
				t.integer('reservation_id').unsigned().notNullable().references('id').inTable('reservations').onDelete('CASCADE');
				t.string('name').notNullable();
				t.integer('quantity').notNullable().defaultTo(1);
			});
		});
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
	return knex.schema
		.dropTableIfExists('reservation_items')
		.then(() => knex.schema.dropTableIfExists('reservations'))
		.then(() => knex.schema.dropTableIfExists('users'));
};
