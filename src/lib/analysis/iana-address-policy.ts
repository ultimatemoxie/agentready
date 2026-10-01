// Generated from IANA registries by scripts/update-ip-policy.mjs. Review changes before use.
export const IANA_ADDRESS_POLICY = {
  "retrievedAt": "2026-09-28T10:42:54.846Z",
  "sources": {
    "ipv4": "https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv",
    "ipv6": "https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv",
    "allocations": "https://www.iana.org/assignments/ipv6-unicast-address-assignments/ipv6-unicast-address-assignments.csv"
  },
  "ipv4": [
    {
      "cidr": "0.0.0.0/8",
      "name": "\"This network\"",
      "globallyReachable": false
    },
    {
      "cidr": "0.0.0.0/32",
      "name": "\"This host on this network\"",
      "globallyReachable": false
    },
    {
      "cidr": "10.0.0.0/8",
      "name": "Private-Use",
      "globallyReachable": false
    },
    {
      "cidr": "100.64.0.0/10",
      "name": "Shared Address Space",
      "globallyReachable": false
    },
    {
      "cidr": "127.0.0.0/8",
      "name": "Loopback",
      "globallyReachable": false
    },
    {
      "cidr": "169.254.0.0/16",
      "name": "Link Local",
      "globallyReachable": false
    },
    {
      "cidr": "172.16.0.0/12",
      "name": "Private-Use",
      "globallyReachable": false
    },
    {
      "cidr": "192.0.0.0/24",
      "name": "IETF Protocol Assignments",
      "globallyReachable": false
    },
    {
      "cidr": "192.0.0.0/29",
      "name": "IPv4 Service Continuity Prefix",
      "globallyReachable": false
    },
    {
      "cidr": "192.0.0.8/32",
      "name": "IPv4 dummy address",
      "globallyReachable": false
    },
    {
      "cidr": "192.0.0.9/32",
      "name": "Port Control Protocol Anycast",
      "globallyReachable": true
    },
    {
      "cidr": "192.0.0.10/32",
      "name": "Traversal Using Relays around NAT Anycast",
      "globallyReachable": true
    },
    {
      "cidr": "192.0.0.170/32",
      "name": "NAT64/DNS64 Discovery",
      "globallyReachable": false
    },
    {
      "cidr": "192.0.0.171/32",
      "name": "NAT64/DNS64 Discovery",
      "globallyReachable": false
    },
    {
      "cidr": "192.0.2.0/24",
      "name": "Documentation (TEST-NET-1)",
      "globallyReachable": false
    },
    {
      "cidr": "192.31.196.0/24",
      "name": "AS112-v4",
      "globallyReachable": true
    },
    {
      "cidr": "192.52.193.0/24",
      "name": "AMT",
      "globallyReachable": true
    },
    {
      "cidr": "192.88.99.0/24",
      "name": "Deprecated (6to4 Relay Anycast)",
      "globallyReachable": false
    },
    {
      "cidr": "192.88.99.2/32",
      "name": "6a44-relay anycast address",
      "globallyReachable": false
    },
    {
      "cidr": "192.168.0.0/16",
      "name": "Private-Use",
      "globallyReachable": false
    },
    {
      "cidr": "192.175.48.0/24",
      "name": "Direct Delegation AS112 Service",
      "globallyReachable": true
    },
    {
      "cidr": "198.18.0.0/15",
      "name": "Benchmarking",
      "globallyReachable": false
    },
    {
      "cidr": "198.51.100.0/24",
      "name": "Documentation (TEST-NET-2)",
      "globallyReachable": false
    },
    {
      "cidr": "203.0.113.0/24",
      "name": "Documentation (TEST-NET-3)",
      "globallyReachable": false
    },
    {
      "cidr": "240.0.0.0/4",
      "name": "Reserved",
      "globallyReachable": false
    },
    {
      "cidr": "255.255.255.255/32",
      "name": "Limited Broadcast",
      "globallyReachable": false
    }
  ],
  "ipv6": [
    {
      "cidr": "::1/128",
      "name": "Loopback Address",
      "globallyReachable": false
    },
    {
      "cidr": "::/128",
      "name": "Unspecified Address",
      "globallyReachable": false
    },
    {
      "cidr": "::ffff:0:0/96",
      "name": "IPv4-mapped Address",
      "globallyReachable": false
    },
    {
      "cidr": "64:ff9b::/96",
      "name": "IPv4-IPv6 Translat.",
      "globallyReachable": true
    },
    {
      "cidr": "64:ff9b:1::/48",
      "name": "IPv4-IPv6 Translat.",
      "globallyReachable": false
    },
    {
      "cidr": "100::/64",
      "name": "Discard-Only Address Block",
      "globallyReachable": false
    },
    {
      "cidr": "100:0:0:1::/64",
      "name": "Dummy IPv6 Prefix",
      "globallyReachable": false
    },
    {
      "cidr": "2001::/23",
      "name": "IETF Protocol Assignments",
      "globallyReachable": false
    },
    {
      "cidr": "2001::/32",
      "name": "TEREDO",
      "globallyReachable": false
    },
    {
      "cidr": "2001:1::1/128",
      "name": "Port Control Protocol Anycast",
      "globallyReachable": true
    },
    {
      "cidr": "2001:1::2/128",
      "name": "Traversal Using Relays around NAT Anycast",
      "globallyReachable": true
    },
    {
      "cidr": "2001:1::3/128",
      "name": "DNS-SD Service Registration Protocol Anycast",
      "globallyReachable": true
    },
    {
      "cidr": "2001:2::/48",
      "name": "Benchmarking",
      "globallyReachable": false
    },
    {
      "cidr": "2001:3::/32",
      "name": "AMT",
      "globallyReachable": true
    },
    {
      "cidr": "2001:4:112::/48",
      "name": "AS112-v6",
      "globallyReachable": true
    },
    {
      "cidr": "2001:10::/28",
      "name": "Deprecated (previously ORCHID)",
      "globallyReachable": false
    },
    {
      "cidr": "2001:20::/28",
      "name": "ORCHIDv2",
      "globallyReachable": true
    },
    {
      "cidr": "2001:30::/28",
      "name": "Drone Remote ID Protocol Entity Tags (DETs) Prefix",
      "globallyReachable": true
    },
    {
      "cidr": "2001:db8::/32",
      "name": "Documentation",
      "globallyReachable": false
    },
    {
      "cidr": "2002::/16",
      "name": "6to4",
      "globallyReachable": false
    },
    {
      "cidr": "2620:4f:8000::/48",
      "name": "Direct Delegation AS112 Service",
      "globallyReachable": true
    },
    {
      "cidr": "3fff::/20",
      "name": "Documentation",
      "globallyReachable": false
    },
    {
      "cidr": "5f00::/16",
      "name": "Segment Routing (SRv6) SIDs",
      "globallyReachable": false
    },
    {
      "cidr": "fc00::/7",
      "name": "Unique-Local",
      "globallyReachable": false
    },
    {
      "cidr": "fe80::/10",
      "name": "Link-Local Unicast",
      "globallyReachable": false
    }
  ],
  "ipv6Allocations": [
    "2001::/23",
    "2001:200::/23",
    "2001:400::/23",
    "2001:600::/23",
    "2001:800::/22",
    "2001:c00::/23",
    "2001:e00::/23",
    "2001:1200::/23",
    "2001:1400::/22",
    "2001:1800::/23",
    "2001:1a00::/23",
    "2001:1c00::/22",
    "2001:2000::/19",
    "2001:4000::/23",
    "2001:4200::/23",
    "2001:4400::/23",
    "2001:4600::/23",
    "2001:4800::/23",
    "2001:4a00::/23",
    "2001:4c00::/23",
    "2001:5000::/20",
    "2001:8000::/19",
    "2001:a000::/20",
    "2001:b000::/20",
    "2002::/16",
    "2003::/18",
    "2400::/12",
    "2410::/12",
    "2600::/12",
    "2610::/23",
    "2620::/23",
    "2630::/12",
    "2800::/12",
    "2a00::/12",
    "2a10::/12",
    "2c00::/12"
  ]
} as const;
