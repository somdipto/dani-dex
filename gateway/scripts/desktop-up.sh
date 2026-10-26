#!/usr/bin/env bash
# Brings up the virtual desktop Dani controls: Xvfb :99, a session bus, the accessibility bus, and the driver.
# usage: scripts/desktop-up.sh   (idempotent). Prints the env the driver runs with.
set -u
D=$HOME/.dani/bin/cua-driver; mkdir -p "$HOME/.dani/run"
pgrep -x Xvfb >/dev/null || { setsid nohup Xvfb :99 -screen 0 1280x800x24 >/tmp/xvfb.log 2>&1 </dev/null & sleep 1; }
ENVF=$HOME/.dani/run/desktop.env
if ! { [ -f "$ENVF" ] && . "$ENVF" && [ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ] && pgrep -f "dbus-daemon.*$(echo "$DBUS_SESSION_BUS_ADDRESS" | sed 's/.*=//;s/,.*//')" >/dev/null; }; then
  dbus-launch --sh-syntax > "$ENVF"; . "$ENVF"
fi
export DISPLAY=:99 DBUS_SESSION_BUS_ADDRESS GNOME_ACCESSIBILITY=1 QT_ACCESSIBILITY=1 NO_AT_BRIDGE=0
pgrep -f at-spi-bus-launcher >/dev/null || { setsid nohup /usr/libexec/at-spi-bus-launcher --launch-immediately >/tmp/atspi.log 2>&1 </dev/null & sleep 1; }
pgrep -f at-spi2-registryd >/dev/null || { setsid nohup /usr/libexec/at-spi2-registryd >/tmp/atspi-reg.log 2>&1 </dev/null & sleep 1; }
pgrep -x xfwm4 >/dev/null || { DISPLAY=:99 setsid nohup xfwm4 --compositor=off >/tmp/xfwm.log 2>&1 </dev/null & sleep 2; }
$D stop >/dev/null 2>&1; sleep 1
setsid nohup $D serve >/tmp/cua.log 2>&1 </dev/null &
sleep 3; $D status 2>&1 | head -2
