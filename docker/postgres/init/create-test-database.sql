-- Runs once, when the container initializes an empty data volume, as POSTGRES_USER.
-- Integration tests empty their tables, so they get a database of their own.
CREATE DATABASE peafowl_test;
