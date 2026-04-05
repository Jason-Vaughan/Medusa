#!/bin/bash

# 🚢 Port Checker Utility for Cross-Workspace Development
# Usage: ./scripts/check-ports.sh [port-range]

echo "🚢 Port Usage Checker - Medusa Workspace"
echo "========================================"

# Check specific Medusa ports
echo ""
echo "📋 Medusa Project Ports:"
echo "------------------------"

ports=(3009 3010 3011 3012)
services=("Medusa WebSocket" "Medusa HTTP/Dashboard" "MCP HTTP (legacy)" "MCP Stdio (Cursor)")

for i in "${!ports[@]}"; do
    port=${ports[$i]}
    service=${services[$i]}
    
    if lsof -i :$port > /dev/null 2>&1; then
        echo "🟢 Port $port: ACTIVE - $service"
        lsof -i :$port | grep LISTEN | awk '{print "   └─ " $1 " (PID: " $2 ")"}'
    else
        echo "🔴 Port $port: FREE - $service"
    fi
done

# Check OnDeck conflict port
echo ""
echo "🔍 Cross-Project Conflict Check:"
echo "--------------------------------"

if lsof -i :3000 > /dev/null 2>&1; then
    echo "⚠️  Port 3000: OCCUPIED (OnDeck Backend)"
    lsof -i :3000 | grep LISTEN | awk '{print "   └─ " $1 " (PID: " $2 ")"}'
else
    echo "✅ Port 3000: FREE (OnDeck not running)"
fi

# Check TiLT ports
if lsof -i :4000 > /dev/null 2>&1; then
    echo "🟢 Port 4000: ACTIVE (TiLT Frontend)"
    lsof -i :4000 | grep LISTEN | awk '{print "   └─ " $1 " (PID: " $2 ")"}'
else
    echo "🔴 Port 4000: FREE (TiLT not running)"
fi

# Show available ports in development range
echo ""
echo "🆓 Available Development Ports:"
echo "------------------------------"

available_count=0
for port in {3001..3008} {3013..3015} {4001..4002} {5000..5001}; do
    if ! lsof -i :$port > /dev/null 2>&1; then
        if [ $available_count -eq 0 ]; then
            echo -n "Available: "
        fi
        echo -n "$port "
        ((available_count++))
        if [ $((available_count % 8)) -eq 0 ]; then
            echo ""
            echo -n "           "
        fi
    fi
done

if [ $available_count -gt 0 ]; then
    echo ""
else
    echo "No available ports in development ranges"
fi

echo ""
echo "📖 For full port registry: cat /Users/jasonvaughan/Documents/Projects/PORT_REGISTRY.md"
echo "🔧 To find specific port: lsof -i :PORT"
echo "🚀 To kill service on port: kill \$(lsof -t -i:PORT)" 