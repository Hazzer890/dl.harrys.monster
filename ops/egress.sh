#!/bin/sh
# Stop the dl container's network (dl-edge, 172.30.0.0/24) opening connections to private,
# loopback, CGNAT, link-local (Hetzner metadata at 169.254.169.254) and multicast addresses.
# Caddy shares dl-edge, so proxied requests still reach dl, and its replies are not NEW.
# Idempotent; run by dl-egress.service after Docker starts.
set -e
iptables -N DL-EGRESS 2>/dev/null || iptables -F DL-EGRESS
for d in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/3; do
  iptables -A DL-EGRESS -d "$d" -j DROP
done
iptables -C DOCKER-USER -s 172.30.0.0/24 -m conntrack --ctstate NEW -j DL-EGRESS 2>/dev/null ||
  iptables -I DOCKER-USER -s 172.30.0.0/24 -m conntrack --ctstate NEW -j DL-EGRESS
