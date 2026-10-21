-- SeaShield migration test fixture: unversioned_cc93f8c_to_88872b3
--
-- Represents: an unversioned install created at cc93f8c and restarted at every later version.
-- Built from historical code (git archive of backend/ at each commit):
--   1. At cc93f8c: application startup's `Base.metadata.create_all` with that commit's models (no demo seeding).
--   2. At c70d429: application startup's `Base.metadata.create_all` with that commit's models (no demo seeding).
--   3. At 88872b3: application startup's `Base.metadata.create_all` with that commit's models (no demo seeding).
--   4. Inserted representative rows into every table present (the *-FX-* rows in the INSERT statements below).
--
-- Alembic version in this state: none (no alembic_version table); rows outside alembic_version: 15.
-- Generated 2026-10-21 with Python sqlite3 Connection.iterdump() (trailing spaces in DDL lines stripped).
-- Used by backend/tests/test_migrations.py.
-- Regenerate only from the same historical commits; do not edit by hand.
BEGIN TRANSACTION;
CREATE TABLE event_acknowledgements (
	id INTEGER NOT NULL,
	event_id VARCHAR(100) NOT NULL,
	acknowledged_by VARCHAR(160) NOT NULL,
	acknowledged_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "event_acknowledgements" VALUES(1,'EVT-FX-2','Officer','2026-09-01 10:00:00.000000');
CREATE TABLE incident_activity (
	id INTEGER NOT NULL,
	incident_id VARCHAR(100) NOT NULL,
	text TEXT NOT NULL,
	actor VARCHAR(160),
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(incident_id) REFERENCES incidents (incident_id)
);
INSERT INTO "incident_activity" VALUES(1,'INC-FX-1','Incident opened.','Officer','2026-09-01 10:00:00.000000');
CREATE TABLE incident_event_links (
	id INTEGER NOT NULL,
	incident_id VARCHAR(100) NOT NULL,
	event_id VARCHAR(100) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_incident_event_link UNIQUE (incident_id, event_id),
	FOREIGN KEY(incident_id) REFERENCES incidents (incident_id)
);
INSERT INTO "incident_event_links" VALUES(1,'INC-FX-1','EVT-FX-1','2026-09-01 10:00:00.000000');
CREATE TABLE incident_notes (
	id INTEGER NOT NULL,
	note_id VARCHAR(100) NOT NULL,
	incident_id VARCHAR(100) NOT NULL,
	author VARCHAR(160) NOT NULL,
	body TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(incident_id) REFERENCES incidents (incident_id)
);
INSERT INTO "incident_notes" VALUES(1,'NOTE-FX-1','INC-FX-1','Officer','Fixture note.','2026-09-01 10:00:00.000000');
CREATE TABLE incidents (
	id INTEGER NOT NULL,
	incident_id VARCHAR(100) NOT NULL,
	vessel_id VARCHAR(100) NOT NULL,
	type VARCHAR(160) NOT NULL,
	title VARCHAR(200) NOT NULL,
	severity VARCHAR(20) NOT NULL,
	status VARCHAR(30) NOT NULL,
	description TEXT NOT NULL,
	assigned_operator VARCHAR(160) NOT NULL,
	investigation_notes TEXT NOT NULL,
	recommended_action TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "incidents" VALUES(1,'INC-FX-1','calypso','Fire/Environmental Emergency','Fire','CRITICAL','NEW','Simulated incident.','J. Dawson','','Contain.','2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000');
CREATE TABLE safety_checkpoints (
	id INTEGER NOT NULL,
	checkpoint_id VARCHAR(100) NOT NULL,
	round_id VARCHAR(100) NOT NULL,
	name VARCHAR(200) NOT NULL,
	description TEXT NOT NULL,
	location VARCHAR(200) NOT NULL,
	required BOOLEAN NOT NULL,
	status VARCHAR(30) NOT NULL,
	severity VARCHAR(20) NOT NULL,
	notes TEXT,
	completed_by VARCHAR(160),
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(round_id) REFERENCES safety_rounds (round_id)
);
INSERT INTO "safety_checkpoints" VALUES(1,'CP-FX-1','RND-FX-1','Gangway','','Deck 2',1,'FAIL','HIGH','Gate open.',NULL,'2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000');
INSERT INTO "safety_checkpoints" VALUES(2,'CP-FX-2','RND-FX-1','Bridge','','Bridge',1,'PASS','INFO','',NULL,'2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000');
CREATE TABLE safety_findings (
	id INTEGER NOT NULL,
	finding_id VARCHAR(100) NOT NULL,
	round_id VARCHAR(100) NOT NULL,
	checkpoint_id VARCHAR(100),
	vessel_id VARCHAR(100) NOT NULL,
	title VARCHAR(200) NOT NULL,
	description TEXT NOT NULL,
	severity VARCHAR(20) NOT NULL,
	status VARCHAR(30) NOT NULL,
	created_by VARCHAR(160) NOT NULL,
	assigned_to VARCHAR(160) NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(round_id) REFERENCES safety_rounds (round_id)
);
INSERT INTO "safety_findings" VALUES(1,'FND-FX-1','RND-FX-1','CP-FX-1','calypso','Gangway gate open','','HIGH','OPEN','Deck Officer','Deck Officer','2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000');
CREATE TABLE safety_rounds (
	id INTEGER NOT NULL,
	round_id VARCHAR(100) NOT NULL,
	vessel_id VARCHAR(100) NOT NULL,
	title VARCHAR(200) NOT NULL,
	description TEXT NOT NULL,
	assigned_to VARCHAR(160) NOT NULL,
	status VARCHAR(30) NOT NULL,
	notes TEXT NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	started_at DATETIME,
	completed_at DATETIME,
	PRIMARY KEY (id)
);
INSERT INTO "safety_rounds" VALUES(1,'RND-FX-1','calypso','Night Security Round','','Deck Officer','IN_PROGRESS','Fixture round notes.','2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000',NULL,NULL);
CREATE TABLE security_events (
	id INTEGER NOT NULL,
	event_id VARCHAR(100) NOT NULL,
	timestamp DATETIME NOT NULL,
	event_type VARCHAR(100) NOT NULL,
	category VARCHAR(30) NOT NULL,
	severity VARCHAR(20) NOT NULL,
	source VARCHAR(160) NOT NULL,
	title VARCHAR(200),
	description TEXT NOT NULL,
	status VARCHAR(20) NOT NULL,
	confidence FLOAT,
	scenario VARCHAR(100),
	vessel_id VARCHAR(100) NOT NULL,
	metadata JSON NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "security_events" VALUES(1,'EVT-FX-1','2026-09-01 10:00:00.000000','FIRE_ALARM','ENVIRONMENTAL','CRITICAL','Fire Panel',NULL,'Simulated fire alarm.','OPEN',0.875,'fixture','calypso','{"zone": "B"}','2026-09-01 10:00:00.000000');
INSERT INTO "security_events" VALUES(2,'EVT-FX-2','2026-09-01 10:00:00.000000','UNAUTHORIZED_ACCESS','PHYSICAL','HIGH','Access Control',NULL,'Simulated badge failure.','RESOLVED',NULL,NULL,'calypso','{}','2026-09-01 10:00:00.000000');
CREATE TABLE security_score_history (
	id INTEGER NOT NULL,
	vessel_id VARCHAR(100) NOT NULL,
	score INTEGER NOT NULL,
	previous_score INTEGER,
	reason VARCHAR(200),
	timestamp DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "security_score_history" VALUES(1,'calypso',92,NULL,'fixture','2026-09-01 10:00:00.000000');
INSERT INTO "security_score_history" VALUES(2,'calypso',72,92,'fixture','2026-09-01 10:00:00.000000');
CREATE TABLE simulation_runs (
	id INTEGER NOT NULL,
	scenario VARCHAR(100) NOT NULL,
	vessel_id VARCHAR(100),
	start_time DATETIME NOT NULL,
	end_time DATETIME,
	status VARCHAR(30) NOT NULL,
	metadata JSON NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "simulation_runs" VALUES(1,'physical-breach','calypso','2026-09-01 10:00:00.000000',NULL,'COMPLETE','{}');
CREATE TABLE vessels (
	id INTEGER NOT NULL,
	vessel_id VARCHAR(100) NOT NULL,
	name VARCHAR(160) NOT NULL,
	imo VARCHAR(100) NOT NULL,
	base_score INTEGER NOT NULL,
	score INTEGER NOT NULL,
	status VARCHAR(30) NOT NULL,
	last_communication DATETIME NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "vessels" VALUES(1,'calypso','MV Calypso','IMO 9751028',92,72,'WARNING','2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000','2026-09-01 10:00:00.000000');
CREATE INDEX ix_security_events_timestamp ON security_events (timestamp);
CREATE INDEX ix_security_events_scenario ON security_events (scenario);
CREATE UNIQUE INDEX ix_security_events_event_id ON security_events (event_id);
CREATE INDEX ix_security_events_severity ON security_events (severity);
CREATE INDEX ix_security_events_event_type ON security_events (event_type);
CREATE INDEX ix_security_events_vessel_id ON security_events (vessel_id);
CREATE INDEX ix_security_events_category ON security_events (category);
CREATE UNIQUE INDEX ix_vessels_vessel_id ON vessels (vessel_id);
CREATE INDEX ix_incidents_type ON incidents (type);
CREATE INDEX ix_incidents_vessel_id ON incidents (vessel_id);
CREATE INDEX ix_incidents_severity ON incidents (severity);
CREATE UNIQUE INDEX ix_incidents_incident_id ON incidents (incident_id);
CREATE INDEX ix_incidents_status ON incidents (status);
CREATE INDEX ix_incidents_created_at ON incidents (created_at);
CREATE INDEX ix_security_score_history_vessel_id ON security_score_history (vessel_id);
CREATE INDEX ix_security_score_history_timestamp ON security_score_history (timestamp);
CREATE UNIQUE INDEX ix_event_acknowledgements_event_id ON event_acknowledgements (event_id);
CREATE INDEX ix_safety_rounds_created_at ON safety_rounds (created_at);
CREATE INDEX ix_safety_rounds_vessel_id ON safety_rounds (vessel_id);
CREATE INDEX ix_safety_rounds_status ON safety_rounds (status);
CREATE UNIQUE INDEX ix_safety_rounds_round_id ON safety_rounds (round_id);
CREATE INDEX ix_simulation_runs_status ON simulation_runs (status);
CREATE INDEX ix_simulation_runs_vessel_id ON simulation_runs (vessel_id);
CREATE INDEX ix_simulation_runs_start_time ON simulation_runs (start_time);
CREATE INDEX ix_simulation_runs_scenario ON simulation_runs (scenario);
CREATE INDEX ix_incident_event_links_event_id ON incident_event_links (event_id);
CREATE INDEX ix_incident_event_links_incident_id ON incident_event_links (incident_id);
CREATE INDEX ix_incident_notes_incident_id ON incident_notes (incident_id);
CREATE INDEX ix_incident_notes_created_at ON incident_notes (created_at);
CREATE UNIQUE INDEX ix_incident_notes_note_id ON incident_notes (note_id);
CREATE INDEX ix_incident_activity_created_at ON incident_activity (created_at);
CREATE INDEX ix_incident_activity_incident_id ON incident_activity (incident_id);
CREATE INDEX ix_safety_checkpoints_severity ON safety_checkpoints (severity);
CREATE UNIQUE INDEX ix_safety_checkpoints_checkpoint_id ON safety_checkpoints (checkpoint_id);
CREATE INDEX ix_safety_checkpoints_round_id ON safety_checkpoints (round_id);
CREATE INDEX ix_safety_checkpoints_status ON safety_checkpoints (status);
CREATE INDEX ix_safety_findings_created_at ON safety_findings (created_at);
CREATE INDEX ix_safety_findings_vessel_id ON safety_findings (vessel_id);
CREATE UNIQUE INDEX ix_safety_findings_finding_id ON safety_findings (finding_id);
CREATE INDEX ix_safety_findings_status ON safety_findings (status);
CREATE INDEX ix_safety_findings_checkpoint_id ON safety_findings (checkpoint_id);
CREATE INDEX ix_safety_findings_round_id ON safety_findings (round_id);
CREATE INDEX ix_safety_findings_severity ON safety_findings (severity);
COMMIT;
