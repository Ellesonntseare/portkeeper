# Portkeeper

A local Windows dashboard for active TCP listening ports, UDP endpoints, and saved project port assignments. Requires Node.js 18 or newer and Windows PowerShell.

## Start

Double-click `Start Portkeeper.cmd`, or run this from the project folder:

```powershell
npm start
```

Open `http://127.0.0.1:8765` in your browser if it did not open automatically. Leave the terminal running while using the dashboard; press Ctrl+C to stop it.

The dashboard refreshes every 45 seconds. **My project ports** contains only saved project assignments and shows whether each port is in use. **Other active ports** contains the remaining system and unassigned ports; use **Add to projects** to move one into your project list. A new assignment on the same port replaces the old one. Assignments are saved in `%LOCALAPPDATA%\Portkeeper\assignments.json`.

The suggested port is checked against current TCP and UDP usage and saved assignments. Port availability can change before your application starts, so the application should still handle an address-in-use error.

**Stop app** closes the process using a project port, which releases every port owned by that process. The button is enabled only when the process and all its ports match saved project folders. Windows services, protected processes, and Portkeeper itself cannot be stopped from the dashboard. Portkeeper checks again immediately before stopping and asks for confirmation in the dashboard.

Windows does not provide a reliable project working directory for every process. Portkeeper shows a folder when a script path appears in the process command line, or labels a folder as coming from a saved assignment. Some process details may be unavailable without elevated permissions.

## Test

```powershell
npm test
```
