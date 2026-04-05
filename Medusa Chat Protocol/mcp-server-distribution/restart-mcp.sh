#!/bin/bash
# Script to safely restart the MCP server and web server

# Handle the stop command
if [ "$1" = "stop" ]; then
    echo "=== Stopping all OnDeck-V9 servers ==="

    # Kill any running Node.js servers
    node_pids=$(pgrep -f "node.*server.js")
    if [ -n "$node_pids" ]; then
        echo "Stopping Node.js servers: $node_pids"
        kill $node_pids
        sleep 1
        node_pids=$(pgrep -f "node.*server.js")
        if [ -n "$node_pids" ]; then
            kill -9 $node_pids
        fi
    fi

    # Kill any running MCP servers (both Node.js and Python)
    mcp_pids=$(pgrep -f "node.*simple-local-server.js\|python.*mcp_server.py")
    if [ -n "$mcp_pids" ]; then
        echo "Stopping MCP servers: $mcp_pids"
        kill $mcp_pids
        sleep 1
        mcp_pids=$(pgrep -f "node.*simple-local-server.js\|python.*mcp_server.py")
        if [ -n "$mcp_pids" ]; then
            kill -9 $mcp_pids
        fi
    fi

    echo "All servers stopped."
    exit 0
fi

echo "=== OnDeck-V9 Server Restart ==="
echo "Checking for running processes..."

# Kill any running Node.js servers
node_pids=$(pgrep -f "node.*server.js")
if [ -n "$node_pids" ]; then
    echo "Found running Node.js servers: $node_pids"
    echo "Stopping Node.js servers..."
    kill $node_pids
    sleep 1

    # Check if any processes are still running
    node_pids=$(pgrep -f "node.*server.js")
    if [ -n "$node_pids" ]; then
        echo "Processes still running, forcing termination..."
        kill -9 $node_pids
    fi

    echo "All Node.js servers stopped."
fi

# Kill any running MCP servers (both Node.js and Python)
mcp_pids=$(pgrep -f "node.*simple-local-server.js\|python.*mcp_server.py")
if [ -n "$mcp_pids" ]; then
    echo "Found running MCP server processes: $mcp_pids"
    echo "Stopping existing MCP servers..."
    kill $mcp_pids
    sleep 1

    # Check if any processes are still running
    mcp_pids=$(pgrep -f "node.*simple-local-server.js\|python.*mcp_server.py")
    if [ -n "$mcp_pids" ]; then
        echo "Processes still running, forcing termination..."
        kill -9 $mcp_pids
    fi

    echo "All MCP server processes stopped."
else
    echo "No running MCP server processes found."
fi

# Start the MCP server using the simple local server
echo "Starting simple local MCP server..."
node simple-local-server.js &
mcp_pid=$!
echo "Local MCP server started with PID: $mcp_pid"

# Wait a bit to ensure the MCP server is up
sleep 2
echo "MCP server status:"
curl -s http://localhost:3009/health

# Return to the project root and start the web server
echo -e "\nStarting web server..."
node server.js &
web_pid=$!
echo "Web server started with PID: $web_pid"

echo -e "\nBoth servers are now running."
echo "Services running at:"
echo "- MCP server: http://localhost:3009"
echo "- Web server: http://localhost:8181"
echo -e "\nTo test the system, open http://localhost:8181 in your browser"
echo "To stop all servers, run: ./restart-mcp.sh stop"
echo -e "\nProcess IDs:"
echo "MCP Server: $mcp_pid"
echo "Web Server: $web_pid"
