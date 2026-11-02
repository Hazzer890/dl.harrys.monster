#!/bin/sh
# Stop the dl container's network (dl-edge) opening connections to private,
# loopback, CGNAT, link-local (Hetzner metadata at 169.254.169.254) and multicast addresses.
# Caddy shares dl-edge, so proxied requests still reach dl, and its replies are not NEW.
# Idempotent; run by dl-egress.service after Docker starts.
set -e
# Read the subnet from Docker rather than assume it, so a recreated network can't leave the
# rules matching nothing. No network, no subnet: exit non-zero and the unit shows as failed.
# ponytail: dl (restart: unless-stopped) can come up a few seconds before this runs at boot;
# order the container after the unit if that window ever matters.
SUBNET=$(docker network inspect -f '{{(index .IPAM.Config 0).Subnet}}' dl-edge)
[ -n "$SUBNET" ] || { echo "dl-edge has no subnet" >&2; exit 1; }
iptables -N DL-EGRESS 2>/dev/null || iptables -F DL-EGRESS
for d in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.168.0.0/16 224.0.0.0/3; do
  iptables -A DL-EGRESS -d "$d" -j DROP
done
iptables -C DOCKER-USER -s "$SUBNET" -m conntrack --ctstate NEW -j DL-EGRESS 2>/dev/null ||
  iptables -I DOCKER-USER -s "$SUBNET" -m conntrack --ctstate NEW -j DL-EGRESS

# Traffic to the host itself (the dl-edge gateway or any host address) skips DOCKER-USER and
# goes through INPUT. Only replies are allowed, so a host service added later stays unreachable.
iptables -N DL-INPUT 2>/dev/null || iptables -F DL-INPUT
iptables -A DL-INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
iptables -A DL-INPUT -j DROP
iptables -C INPUT -s "$SUBNET" -j DL-INPUT 2>/dev/null || iptables -I INPUT -s "$SUBNET" -j DL-INPUT
