# Service Account Setup for SheetSync MCP

This guide explains how to properly set up the service account for SheetSync MCP to access Apps Script.

## Service Account Information

- **Service Account Email**: `mcp-server@ondeck-mcp.iam.gserviceaccount.com`
- **Script ID**: `1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9`

## Required Steps

### 1. Enable the Apps Script API in your Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/library/script.googleapis.com)
2. Make sure you're in the `ondeck-mcp` project
3. Click "Enable" for the Apps Script API
4. Wait a few minutes for the change to propagate

### 2. Grant the Service Account Proper Permissions in Google Cloud Console

1. Go to [IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Find the service account: `mcp-server@ondeck-mcp.iam.gserviceaccount.com`
3. Click on it and go to the "Permissions" tab
4. Add the following roles:
   - Apps Script API User
   - Apps Script API Admin
   - Service Account User
   - Service Account Token Creator

### 3. Share the Apps Script Project with the Service Account

1. Open the Apps Script editor at:
   ```
   https://script.google.com/d/1MgE39XhFyQlvCgVfRpl6bPBO2bmC27W2k5CcuQLb4viF2Uh8QeGnysn9/edit
   ```
2. Click the "Share" button in the top-right corner
3. Add the service account email: `mcp-server@ondeck-mcp.iam.gserviceaccount.com`
4. Grant Editor permissions
5. Uncheck "Notify people" (since service accounts don't have email inboxes)
6. Add a note like "MCP Server Access"
7. Click "Share"

### 4. Deploy the Script as an API Executable

1. In the Apps Script editor, click on the "Deploy" button
2. Select "New deployment"
3. Choose "API Executable" as the deployment type
4. Set the description to "SheetSync MCP API"
5. Click "Deploy"
6. Copy the "Deployment ID" (not the Script ID)
7. Make sure all OAuth scopes are included in the deployment

### 5. Update the Apps Script Code Permissions

1. In the Apps Script editor, click on "Project Settings" (the gear icon)
2. Go to the "Script Properties" tab
3. Click "Add Script Property"
4. Add a property named "SERVICE_ACCOUNT_EMAIL" with the value of your service account email
5. Under "Show 'appsscript.json' manifest" ensure the following scopes are included:
   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/script.deployments",
     "https://www.googleapis.com/auth/script.processes",
     "https://www.googleapis.com/auth/script.projects",
     "https://www.googleapis.com/auth/spreadsheets",
     "https://www.googleapis.com/auth/drive"
   ]
   ```

### 6. Test the Connection

After completing these steps, run the direct test script:

```
node direct-apps-script.js
```

If you're still experiencing issues, check the Google Cloud Console "Activity" section to see if there are any authorization errors that need to be addressed. 