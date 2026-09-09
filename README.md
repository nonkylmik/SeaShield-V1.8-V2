# SeaShield V1.8 + V2

This merged copy uses the V1.8 FastAPI, WebSocket, persistence, simulation, and correlation engine in `backend/` with the V2 React/TanStack desktop interface.

## Run

1. Create/activate a Python environment, install `backend/requirements.txt`, then start V1.8 with `cd backend; python -m uvicorn app.main:app --reload --port 8000`.
2. At this project root: `npm install; npm run dev`
3. Open the V2 console. It connects to `http://localhost:8000`; set `VITE_API_URL` for another backend address.

V2 hydrates vessels, cameras, events, incidents, simulation actions, and WebSocket updates from V1.8. V2-only device telemetry remains explicitly simulated until V1.8 supplies equivalent API endpoints.

---

# Maritime Watch

SeaShield — Native Application Prototype

Building/developing a professional desktop application prototype called SeaShield.

SeaShield is intended to become a dedicated maritime security application for commercial cargo vessels and shipping companies.

This is NOT intended to be a normal public-facing website or generic web application.

The primary target is a desktop security operations application used by security operators, vessel managers and administrators on Windows/Linux workstations.

The application should eventually be capable of operating alongside a local vessel/edge server and communicating with a central backend.

Product concept

SeaShield combines physical and cybersecurity monitoring for commercial vessels.

The eventual application will integrate:

CCTV

Access control

Sensors

Alarms

Vessel systems

Network monitoring

Cybersecurity events

Security incidents

Fleet monitoring

Security analytics

Compliance and reporting

For Prototype V1, ALL vessel systems and security events must be simulated.

Do NOT connect to real vessels, cameras, networks or security infrastructure yet.

Application architecture

Design the project around this future architecture:

                SEASHIELD DESKTOP APP
                         │
                         │ API
                         ↓
                  Python / FastAPI
                         │
             ┌───────────┴───────────┐
             ↓                       ↓
       Security Engine          PostgreSQL
             │
       ┌─────┼──────┐
       ↓     ↓      ↓
    Events  AI    Simulation
       │
       ↓
 Vessel / Edge Systems
       │
 ┌─────┼─────────────┐
 ↓     ↓             ↓
CCTV  Sensors   Network Systems


The desktop application's UI should therefore communicate with backend services through clearly separated service/API layers.

For V1, these APIs can use mock/simulated data.

Later, they will communicate with a Python/FastAPI backend.

Technology for Prototype V1

Used:

React,

TypeScript,

JavaScript,

Tailwind CSS,

Component-based architecture,

React Router where appropriate,

Mock data/services for V1

Structure the project so it can later be packaged as a desktop application, for example using an appropriate desktop wrapper such as Electron or Tauri.

Desktop application experience

The application should behave like a dedicated security operations program.

It should have:

Persistent application navigation

Full-screen desktop layout

Dense information display

Keyboard/mouse-friendly controls

Multi-panel monitoring

Real-time-looking status updates

Notifications

Security alerts

Incident investigation

Fleet monitoring

There should be no landing page, pricing page, blog, marketing sections or website-style navigation.

The user should launch SeaShield and immediately enter the security operations environment.

Visual design

IT has professional maritime security / cybersecurity operations aesthetic.

Style:

Dark interface

Navy/charcoal foundation

Blue/cyan accents

High contrast

Clear status indicators

Professional typography

Dense but readable information

Subtle animations

Minimal decorative elements

The application should feel similar to professional:

SOC software

NOC monitoring software

maritime operations software

enterprise security software

Main application navigation

Application sidebar:

Dashboard

Fleet

Vessels

Cameras

Cybersecurity

Incidents

Sensors

Access Control

Reports

Settings

Top application bar:

SeaShield logo/name

Fleet/vessel selector

Global search

Notifications

Current system status

User profile

Prototype functionality

Implement the previously specified SeaShield functionality:

Dashboard

Shows:

Fleet security status

Vessels monitored

Cameras online

Active incidents

Cybersecurity alerts

Sensors online

Unauthorized access attempts

Recent security events

Fleet

Show fictional cargo vessels with:

Vessel name

Fictional IMO-style identifier

Security status

Camera status

Cybersecurity status

Active incidents

Last communication

Vessel Security

For each vessel show:

Physical security

CCTV

Access control

Sensors

Cybersecurity

Network status

GPS/AIS status

Security score

CCTV

Create simulated camera feeds for:

Bridge

Main Deck

Cargo Area

Engine Room

Port Side

Starboard Side

Stern

Entrance

These are clearly simulated/placeholder feeds.

Cybersecurity

Show simulated:

Unknown devices

Failed authentication attempts

Suspicious traffic

Firewall blocks

Network anomalies

Security events

Incidents

Implement:

Incident creation

Severity

Status

Timeline

Related events

Affected vessel/system

Investigation notes

Operator assignment

Sensors

Simulate:

Fire

Smoke

Temperature

Water

Motion

Door

Bilge

Access Control

Simulates:

Authorized access

Denied access

Suspicious access

Restricted areas

Reports

Shows:

Security events

Incidents

Camera uptime

Sensor uptime

Access violations

Security score

Security simulation

Implement a Prototype V1 simulation engine.

Allow the operator to manually trigger:

Camera failure

Unauthorized access

Unknown network device

Brute-force login attempt

Suspicious network traffic

GPS anomaly

Sensor failure

Firewall block

Fire alarm

The simulated events should update the application dynamically.

For example:

Unknown device detected
        ↓
Cybersecurity warning
        ↓
Multiple failed login attempts
        ↓
Suspicious outbound traffic
        ↓
Potential Network Intrusion
        ↓
HIGH severity incident
        ↓
Operator notification


Implemented basic rule-based event correlation.

Future backend compatibility

Keeps all mock data and service calls separated from the UI.

Uses service abstractions such as:

vesselService
cameraService
sensorService
eventService
incidentService
securityService


The current implementation can return simulated data.

Later these services will call:

Python
    ↓
FastAPI
    ↓
PostgreSQL


Prototype goal

The objective is to create a convincing desktop prototype of a maritime security command application.

The prototype should demonstrate how SeaShield could eventually monitor an entire fleet and individual vessels by combining:

Physical Security + Cybersecurity + Incident Management + Vessel Monitoring

The application must feel like a real security product, while all data and security activity remain simulated during Prototype V1.

The attempt does not implement real vessel control, real cyber attacks, real network intrusion capabilities, real CCTV streaming or real ship-system integration.

This project was built partially as a design with  [Lovable](https://lovable.dev).


## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
