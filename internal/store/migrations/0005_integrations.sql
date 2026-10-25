-- +goose Up
CREATE TABLE integration_state (
  key TEXT PRIMARY KEY,
  value BLOB NOT NULL,
  owner TEXT REFERENCES users(id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE integration_state;
