-- SeaShield migration test fixture: committed_96622fb
--
-- Represents: the backend/seashield.db file committed to git at 96622fb (Initial SeaShield V1.8-V2), unmodified.
-- Anyone who cloned this commit started with this database. The file was removed from the repository in c70d429.
-- Source: git blob fbe1ffc1e0de9fde2ef3495e774057a60c60782d (sha256 89a2d10f9297f42113ff10a32f6c18d89e19b1358e5fb5c1c2b1aaad64df7e52).
-- Contents are simulation data produced by the application; no rows were added or changed.
--
-- Alembic version in this state: 20260903_0002; rows outside alembic_version: 45.
-- Generated 2026-10-21 with Python sqlite3 Connection.iterdump() (trailing spaces in DDL lines stripped).
-- Used by backend/tests/test_migrations.py.
-- Regenerate only from the same historical commits; do not edit by hand.
BEGIN TRANSACTION;
CREATE TABLE alembic_version (
	version_num VARCHAR(32) NOT NULL,
	CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
INSERT INTO "alembic_version" VALUES('20260903_0002');
CREATE TABLE incident_event_links (
	id INTEGER NOT NULL,
	incident_id VARCHAR(100) NOT NULL,
	event_id VARCHAR(100) NOT NULL,
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	CONSTRAINT uq_incident_event_link UNIQUE (incident_id, event_id),
	FOREIGN KEY(incident_id) REFERENCES incidents (incident_id)
);
INSERT INTO "incident_event_links" VALUES(1,'INC-0241','evt-4bb8d53335','2026-09-07 20:21:10.507074');
INSERT INTO "incident_event_links" VALUES(2,'INC-0241','evt-d3ae8fd5c4','2026-09-07 20:21:10.507077');
INSERT INTO "incident_event_links" VALUES(3,'INC-0241','evt-da8f0da602','2026-09-07 20:21:10.507078');
INSERT INTO "incident_event_links" VALUES(4,'INC-0241','evt-551b81cf47','2026-09-07 20:21:10.507079');
INSERT INTO "incident_event_links" VALUES(5,'INC-0241','evt-7268f9dde7','2026-09-07 20:21:10.507080');
INSERT INTO "incident_event_links" VALUES(6,'INC-0241','evt-53eb42555a','2026-09-07 20:21:10.507080');
INSERT INTO "incident_event_links" VALUES(7,'INC-0241','evt-d02e84f4d4','2026-09-07 20:21:10.507081');
INSERT INTO "incident_event_links" VALUES(8,'INC-0241','evt-a5d1dd9413','2026-09-07 20:21:10.507082');
INSERT INTO "incident_event_links" VALUES(9,'INC-0241','evt-ab092b6c3e','2026-09-07 20:21:15.421195');
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
INSERT INTO "incidents" VALUES(1,'INC-0241','calypso','Potential Network Intrusion','Potential Network Intrusion','CRITICAL','NEW','Multiple simulated cyber indicators correlate into a potential network intrusion.','J. Dawson','','Review related events and confirm containment.','2026-09-07 20:21:10.496881','2026-09-07 20:21:10.496883');
CREATE TABLE "security_events" (
	id INTEGER NOT NULL,
	event_id VARCHAR(100) NOT NULL,
	timestamp DATETIME NOT NULL,
	event_type VARCHAR(100) NOT NULL,
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
	category VARCHAR(30) NOT NULL,
	PRIMARY KEY (id),
	UNIQUE (event_id)
);
INSERT INTO "security_events" VALUES(1,'evt-a5d1dd9413','2026-09-03 19:51:24.996334','UNKNOWN_DEVICE','HIGH','Network Monitor',NULL,'Unknown device detected.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 19:51:24.997912','CYBER');
INSERT INTO "security_events" VALUES(2,'evt-d02e84f4d4','2026-09-03 19:51:25.022545','FAILED_AUTHENTICATION','MEDIUM','Identity Gateway',NULL,'Multiple failed authentication attempts.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 19:51:25.023013','CYBER');
INSERT INTO "security_events" VALUES(3,'evt-53eb42555a','2026-09-03 19:51:25.031003','FAILED_AUTHENTICATION','MEDIUM','Identity Gateway',NULL,'Repeated failed authentication attempts.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 19:51:25.031596','CYBER');
INSERT INTO "security_events" VALUES(4,'evt-7268f9dde7','2026-09-03 19:51:25.039130','SUSPICIOUS_TRAFFIC','HIGH','Network Monitor',NULL,'Suspicious outbound traffic detected.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 19:51:25.039581','CYBER');
INSERT INTO "security_events" VALUES(5,'evt-53be45add4','2026-09-03 19:51:25.050275','FIREWALL_BLOCK','MEDIUM','Firewall',NULL,'Outbound traffic blocked by policy.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 19:51:25.050860','CYBER');
INSERT INTO "security_events" VALUES(6,'evt-96d8fa33bd','2026-09-03 20:00:26.457392','UNAUTHORIZED_ACCESS','HIGH','Access Control',NULL,'Unauthorized access in a restricted area.','OPEN',NULL,'physical-breach','calypso','{}','2026-09-03 20:00:26.459431','PHYSICAL');
INSERT INTO "security_events" VALUES(7,'evt-d26b5766b4','2026-09-03 20:00:28.290104','CAMERA_OFFLINE','HIGH','CCTV',NULL,'Nearby camera stopped responding.','OPEN',NULL,'physical-breach','calypso','{}','2026-09-03 20:00:28.290633','PHYSICAL');
INSERT INTO "security_events" VALUES(8,'evt-a45cd52a44','2026-09-03 20:00:57.247915','GPS_ANOMALY','MEDIUM','GPS',NULL,'GPS position variance exceeds tolerance.','OPEN',NULL,'navigation-anomaly','meridian','{}','2026-09-03 20:00:57.248309','VESSEL_SYSTEM');
INSERT INTO "security_events" VALUES(9,'evt-aebfc6a443','2026-09-03 20:00:59.090911','AIS_ANOMALY','MEDIUM','AIS',NULL,'AIS report is inconsistent.','OPEN',NULL,'navigation-anomaly','meridian','{}','2026-09-03 20:00:59.092417','VESSEL_SYSTEM');
INSERT INTO "security_events" VALUES(10,'evt-c838411c2e','2026-09-03 20:01:00.921530','COMMUNICATION_INSTABILITY','HIGH','Edge Gateway',NULL,'Communication instability detected.','OPEN',NULL,'navigation-anomaly','meridian','{}','2026-09-03 20:01:00.921951','VESSEL_SYSTEM');
INSERT INTO "security_events" VALUES(11,'evt-551b81cf47','2026-09-03 20:49:16.184456','UNKNOWN_DEVICE','HIGH','Network Monitor',NULL,'Unknown device detected.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 20:49:16.186352','CYBER');
INSERT INTO "security_events" VALUES(12,'evt-da8f0da602','2026-09-03 20:49:18.024187','FAILED_AUTHENTICATION','MEDIUM','Identity Gateway',NULL,'Multiple failed authentication attempts.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 20:49:18.025996','CYBER');
INSERT INTO "security_events" VALUES(13,'evt-d3ae8fd5c4','2026-09-03 20:49:19.868394','FAILED_AUTHENTICATION','MEDIUM','Identity Gateway',NULL,'Repeated failed authentication attempts.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 20:49:19.868839','CYBER');
INSERT INTO "security_events" VALUES(14,'evt-4bb8d53335','2026-09-03 20:49:21.703924','SUSPICIOUS_TRAFFIC','HIGH','Network Monitor',NULL,'Suspicious outbound traffic detected.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 20:49:21.704368','CYBER');
INSERT INTO "security_events" VALUES(15,'evt-7dad0d419a','2026-09-03 20:49:23.542908','FIREWALL_BLOCK','MEDIUM','Firewall',NULL,'Outbound traffic blocked by policy.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-03 20:49:23.543519','CYBER');
INSERT INTO "security_events" VALUES(16,'evt-da6b5f9a2f','2026-09-07 20:21:10.399050','UNAUTHORIZED_ACCESS','HIGH','Access Control',NULL,'Unauthorized access in a restricted area.','OPEN',NULL,'physical-breach','calypso','{}','2026-09-07 20:21:10.410379','PHYSICAL');
INSERT INTO "security_events" VALUES(17,'evt-ab092b6c3e','2026-09-07 20:21:15.348035','UNKNOWN_DEVICE','HIGH','Network Monitor',NULL,'Unknown device detected.','OPEN',NULL,'cyber-intrusion','calypso','{}','2026-09-07 20:21:15.349194','CYBER');
CREATE TABLE security_score_history (
	id INTEGER NOT NULL,
	vessel_id VARCHAR(100) NOT NULL,
	score INTEGER NOT NULL,
	previous_score INTEGER,
	reason VARCHAR(200),
	timestamp DATETIME NOT NULL,
	PRIMARY KEY (id)
);
INSERT INTO "security_score_history" VALUES(1,'baltic-guardian',96,NULL,'simulation_update','2026-09-07 20:21:10.430270');
INSERT INTO "security_score_history" VALUES(2,'northern-star',94,NULL,'simulation_update','2026-09-07 20:21:10.442906');
INSERT INTO "security_score_history" VALUES(3,'ocean-sentinel',92,NULL,'simulation_update','2026-09-07 20:21:10.454379');
INSERT INTO "security_score_history" VALUES(4,'atlantic-trader',95,NULL,'simulation_update','2026-09-07 20:21:10.466343');
INSERT INTO "security_score_history" VALUES(5,'iron-horizon',93,NULL,'simulation_update','2026-09-07 20:21:10.477422');
INSERT INTO "security_score_history" VALUES(6,'calypso',0,NULL,'simulation_update','2026-09-07 20:21:10.489744');
INSERT INTO "security_score_history" VALUES(7,'baltic-guardian',96,96,'simulation_update','2026-09-07 20:21:15.360624');
INSERT INTO "security_score_history" VALUES(8,'northern-star',94,94,'simulation_update','2026-09-07 20:21:15.371319');
INSERT INTO "security_score_history" VALUES(9,'ocean-sentinel',92,92,'simulation_update','2026-09-07 20:21:15.381955');
INSERT INTO "security_score_history" VALUES(10,'atlantic-trader',95,95,'simulation_update','2026-09-07 20:21:15.392276');
INSERT INTO "security_score_history" VALUES(11,'iron-horizon',93,93,'simulation_update','2026-09-07 20:21:15.402153');
INSERT INTO "security_score_history" VALUES(12,'calypso',0,0,'simulation_update','2026-09-07 20:21:15.411997');
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
INSERT INTO "vessels" VALUES(1,'baltic-guardian','MV Baltic Guardian','IMO 9384751',96,96,'SECURE','2026-09-07 20:21:15.355184','2026-09-06 21:40:08.711258','2026-09-07 20:21:15.355187');
INSERT INTO "vessels" VALUES(2,'northern-star','MV Northern Star','IMO 9410283',94,94,'SECURE','2026-09-07 20:21:15.366071','2026-09-06 21:40:08.720586','2026-09-07 20:21:15.366075');
INSERT INTO "vessels" VALUES(3,'ocean-sentinel','MV Ocean Sentinel','IMO 9521846',92,92,'SECURE','2026-09-07 20:21:15.376328','2026-09-06 21:40:08.727621','2026-09-07 20:21:15.376332');
INSERT INTO "vessels" VALUES(4,'atlantic-trader','MV Atlantic Trader','IMO 9673052',95,95,'SECURE','2026-09-07 20:21:15.386954','2026-09-06 21:40:08.733332','2026-09-07 20:21:15.386957');
INSERT INTO "vessels" VALUES(5,'iron-horizon','MV Iron Horizon','IMO 9714457',93,93,'SECURE','2026-09-07 20:21:15.397620','2026-09-06 21:40:08.740641','2026-09-07 20:21:15.397624');
INSERT INTO "vessels" VALUES(6,'calypso','MV Calypso','IMO 9751028',92,0,'CRITICAL','2026-09-07 20:21:15.406710','2026-09-06 21:40:08.746537','2026-09-07 20:21:15.406714');
CREATE INDEX ix_security_events_severity ON security_events (severity);
CREATE INDEX ix_security_events_event_id ON security_events (event_id);
CREATE INDEX ix_security_events_scenario ON security_events (scenario);
CREATE INDEX ix_security_events_event_type ON security_events (event_type);
CREATE INDEX ix_security_events_category ON security_events (category);
CREATE INDEX ix_security_events_timestamp ON security_events (timestamp);
CREATE INDEX ix_security_events_vessel_id ON security_events (vessel_id);
CREATE UNIQUE INDEX ix_vessels_vessel_id ON vessels (vessel_id);
CREATE UNIQUE INDEX ix_incidents_incident_id ON incidents (incident_id);
CREATE INDEX ix_incidents_type ON incidents (type);
CREATE INDEX ix_incidents_severity ON incidents (severity);
CREATE INDEX ix_incidents_status ON incidents (status);
CREATE INDEX ix_incidents_vessel_id ON incidents (vessel_id);
CREATE INDEX ix_incidents_created_at ON incidents (created_at);
CREATE INDEX ix_security_score_history_vessel_id ON security_score_history (vessel_id);
CREATE INDEX ix_security_score_history_timestamp ON security_score_history (timestamp);
CREATE INDEX ix_simulation_runs_start_time ON simulation_runs (start_time);
CREATE INDEX ix_simulation_runs_status ON simulation_runs (status);
CREATE INDEX ix_simulation_runs_scenario ON simulation_runs (scenario);
CREATE INDEX ix_simulation_runs_vessel_id ON simulation_runs (vessel_id);
CREATE INDEX ix_incident_event_links_incident_id ON incident_event_links (incident_id);
CREATE INDEX ix_incident_event_links_event_id ON incident_event_links (event_id);
COMMIT;
