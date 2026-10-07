# SeaShield SaaS — Maritime Security Operations Platform

**SeaShield** is a desktop-oriented maritime security operations prototype designed for commercial cargo vessels and shipping companies.

The project combines **physical security monitoring, cybersecurity monitoring, incident management, vessel monitoring, simulation, event correlation, and real-time system communication** into a single security operations interface.

> **Prototype status:** SeaShield currently operates entirely with simulated vessel systems, security events, and telemetry. It does not connect to real vessels, cameras, networks, or maritime infrastructure.

---

## Overview

SeaShield is being developed as a dedicated security operations application rather than a conventional public-facing website.

The long-term concept is a desktop application used by:

* Security operators
* Vessel managers
* Fleet administrators
* Security teams

The application is designed around a future architecture where a desktop client communicates with backend services and, eventually, local vessel/edge infrastructure.

### Core monitoring areas

* 🚢 Fleet & vessel monitoring
* 📹 CCTV monitoring
* 🔐 Access control
* 🌡️ Environmental & vessel sensors
* 🛡️ Cybersecurity monitoring
* 🚨 Security incidents
* 🌐 Network events
* 📊 Security analytics
* 📋 Reporting & compliance
* ⚡ Real-time event updates
* 🧪 Security event simulation

---

# Current Architecture

The current repository combines two major development stages:

**V1.8 Backend**

* Python
* FastAPI
* WebSockets
* Persistence
* Simulation engine
* Rule-based event correlation

**V2 Frontend**

* React
* TypeScript
* TanStack
* Tailwind CSS
* Desktop-oriented security operations interface

### Architecture overview

```text
                    SEASHIELD V2
              React / TypeScript UI
                       │
                       │ HTTP / WebSocket
                       ▼
                SEASHIELD V1.8
                  FastAPI API
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
      Simulation   Correlation   Persistence
        Engine        Engine
          │            │
          └──────┬─────┘
                 ▼
          Simulated Vessel
           Security Events
```

The architecture is intentionally separated so that simulated data can eventually be replaced by real backend and vessel/edge integrations without redesigning the entire user interface.

---

# Implemented Features

## Dashboard

The dashboard provides an operational overview of the simulated fleet, including:

* Fleet security status
* Monitored vessels
* Camera availability
* Active incidents
* Cybersecurity alerts
* Sensor status
* Unauthorized access attempts
* Recent security events

## Fleet & Vessel Monitoring

Individual fictional cargo vessels include simulated:

* Vessel identity
* IMO-style identifiers
* Security status
* Camera status
* Cybersecurity status
* Active incidents
* Last communication
* Network status
* GPS/AIS status
* Security score

## CCTV Monitoring

Simulated camera feeds are provided for areas such as:

* Bridge
* Main Deck
* Cargo Area
* Engine Room
* Port Side
* Starboard Side
* Stern
* Entrance

These feeds are explicitly **simulated/placeholder data** and do not represent real CCTV streams.

## Cybersecurity Monitoring

The system can simulate events including:

* Unknown devices
* Failed authentication attempts
* Suspicious network traffic
* Firewall blocks
* Network anomalies
* Security events
* GPS anomalies

## Incident Management

Security incidents support information such as:

* Severity
* Status
* Timeline
* Related events
* Affected vessel/system
* Investigation notes
* Operator assignment

## Sensors

The simulation layer can generate events for:

* Fire
* Smoke
* Temperature
* Water
* Motion
* Door
* Bilge

## Access Control

Simulated access-control events include:

* Authorized access
* Denied access
* Suspicious access
* Restricted-area access

---

# Security Simulation & Event Correlation

SeaShield includes a simulation engine designed to demonstrate how security events could propagate through a maritime security monitoring system.

Operators can manually trigger simulated events such as:

* Camera failure
* Unauthorized access
* Unknown network device
* Brute-force login attempt
* Suspicious network traffic
* GPS anomaly
* Sensor failure
* Firewall block
* Fire alarm

Events can then be processed by the correlation logic.

### Example simulated scenario

```text
Unknown device detected
        ↓
Cybersecurity warning
        ↓
Multiple failed authentication attempts
        ↓
Suspicious outbound traffic
        ↓
Potential network intrusion
        ↓
High-severity incident
        ↓
Operator notification
```

The project currently uses **rule-based event correlation** to demonstrate how multiple related events could contribute to a higher-level security incident.

---

# Testing & Validation

Testing and validation are an important part of the SeaShield development process.

The system is validated across the frontend, backend, API communication, simulated security events, and real-time communication layers.

### API Endpoint Testing

FastAPI endpoints are validated for:

* Expected responses
* Request handling
* Event processing
* Data retrieval
* Error conditions
* Communication between frontend services and the backend

### Frontend / Backend Integration Testing

The V2 interface is connected to the V1.8 backend and validated through:

* API requests
* Backend data hydration
* Vessel data retrieval
* Event retrieval
* Incident handling
* Simulation actions
* Real-time updates

This verifies that the React interface and Python backend operate together rather than functioning as isolated components.

### Simulated Security-Event Testing

Security scenarios can be manually triggered to verify that the system responds to different simulated conditions.

Examples include:

* Unauthorized access
* Unknown devices
* Failed authentication
* Network anomalies
* Firewall blocks
* Sensor failures
* Fire alarms
* GPS anomalies

### System Response Validation

Simulated events are used to validate how the application responds to changing security conditions.

For example:

```text
Event Generated
      ↓
Backend Processing
      ↓
Event Classification
      ↓
Correlation Rules
      ↓
Incident / Alert
      ↓
Frontend Update
      ↓
Operator Notification
```

This allows the prototype to demonstrate an end-to-end security-event workflow.

### Error Handling & Edge Cases

The application is also developed and validated around abnormal conditions such as:

* Invalid or unexpected requests
* Failed backend communication
* Missing data
* Service/API errors
* Unavailable simulated systems
* Invalid event conditions

### WebSocket Communication Testing

SeaShield V1.8 uses WebSockets for real-time communication between the backend and frontend.

WebSocket communication is used to validate:

* Real-time event delivery
* Security-event updates
* Dynamic interface updates
* Simulation-generated events
* Backend-to-frontend state changes

---

# Technology Stack

### Frontend

* React
* TypeScript
* JavaScript
* TanStack
* Tailwind CSS
* Component-based architecture

### Backend

* Python
* FastAPI
* Uvicorn
* WebSockets
* Persistence layer
* Rule-based event correlation
* Simulation engine

### Development

* Git
* GitHub
* npm
* Python virtual environments

---

# Running SeaShield

## 1. Start the Backend

Create and activate a Python virtual environment and install the backend dependencies:

```bash
cd backend
pip install -r requirements.txt
```

Start the FastAPI server:

```bash
python -m uvicorn app.main:app --reload --port 8000
```

The backend will run on:

```text
http://localhost:8000
```

---

## 2. Start the V2 Frontend

From the project root:

```bash
npm install
npm run dev
```

Open the V2 interface using the local development URL provided by Vite.

By default, the frontend communicates with:

```text
http://localhost:8000
```

A different backend address can be configured through:

```text
VITE_API_URL
```

---

# V1.8 → V2 Integration

The V2 interface consumes functionality provided by the V1.8 backend.

Currently integrated areas include:

* Vessels
* Cameras
* Events
* Incidents
* Simulation actions
* WebSocket updates
* Backend persistence

Some V2-only device telemetry remains simulated where an equivalent V1.8 backend endpoint has not yet been implemented.

---

# Project Structure

```text
SeaShield/
│
├── backend/
│   ├── app/
│   │   ├── ...
│   │   └── main.py
│   └── requirements.txt
│
├── src/
│   ├── ...
│   └── ...
│
├── package.json
├── README.md
└── ...
```

The frontend and backend are intentionally separated to support future development and integration.

---

# Development Direction

The long-term SeaShield architecture is intended to evolve toward:

```text
             SEA SHIELD DESKTOP APP
                       │
                       │ API / WebSocket
                       ▼
                Central Backend
                 Python / FastAPI
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
    Security Engine             Database
          │
          ▼
     Vessel / Edge Server
          │
     ┌────┼─────────────┐
     ▼    ▼             ▼
    CCTV Sensors   Network Systems
```

Future development may include:

* Advanced event correlation
* AI-assisted detection
* PostgreSQL-based persistence
* Real vessel/edge-server communication
* Real CCTV integrations
* Network monitoring integrations
* Expanded fleet analytics
* Compliance and reporting functionality
* Additional automated testing
* Production-grade security controls

These features are **future development goals and are not represented as currently implemented functionality**.

---

# Prototype Limitations

SeaShield is currently a software prototype and simulation environment.

It does **not** currently provide:

* Real vessel control
* Real maritime infrastructure integration
* Real CCTV streaming
* Real network intrusion capabilities
* Real cyberattack functionality
* Real sensor hardware integration
* Real vessel-system control
* Production maritime security deployment

All vessel systems, security events, telemetry, and security activity are simulated for development and demonstration purposes.

---

# Project Goal

The goal of SeaShield is to demonstrate how physical security and cybersecurity monitoring could be combined into a unified maritime security operations platform.

The prototype brings together:

**Physical Security + Cybersecurity + Event Correlation + Incident Management + Fleet Monitoring**

into a single desktop-oriented security operations environment.

---

## Development

SeaShield is an independent development project built through iterative prototyping, backend development, frontend development, integration work, and system simulation.

The V2 interface was partially developed with [Lovable](https://lovable.dev), while the backend, integration, simulation, and system architecture have been developed and integrated as part of the project.

---

## Project Status

**Current version:** V1.8 Backend + V2 Frontend

**Status:** Active prototype development

The project is currently focused on strengthening backend/frontend integration, simulation, event correlation, testing, and the foundation required for future maritime security integrations.
