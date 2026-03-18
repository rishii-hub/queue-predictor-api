-- database/schema.sql
-- Description: Initial schema for PostgreSQL MVP

CREATE TABLE IF NOT EXISTS pois (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    poi_type VARCHAR(50) NOT NULL, -- 'HOSPITAL', 'BANK', 'TEMPLE'
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255), -- UUID or anonymized ID for passive tracking
    poi_id INTEGER REFERENCES pois(id),
    wait_time_category VARCHAR(20) NOT NULL, -- 'SHORT', 'MEDIUM', 'LONG'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed some initial POIs for the MVP
INSERT INTO pois (name, poi_type, latitude, longitude) VALUES
('City General Hospital', 'HOSPITAL', 28.6139, 77.2090),
('State Bank Branch A', 'BANK', 28.6145, 77.2105),
('Grand Temple', 'TEMPLE', 28.6150, 77.2150)
ON CONFLICT DO NOTHING;
