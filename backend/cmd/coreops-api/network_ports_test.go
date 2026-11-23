package main

import "testing"

func TestListeningPortsKeepProtocolAndBindAttributionSeparate(t *testing.T) {
	output := `Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port Process
tcp LISTEN 0 128 0.0.0.0:53 0.0.0.0:* users:(("dns-tcp",pid=10,fd=1))
udp UNCONN 0 0 0.0.0.0:53 0.0.0.0:* users:(("dns-udp",pid=11,fd=1))
tcp LISTEN 0 128 192.0.2.1:8080 0.0.0.0:* users:(("docker-proxy",pid=12,fd=1))
tcp LISTEN 0 128 192.0.2.2:8080 0.0.0.0:* users:(("docker-proxy",pid=13,fd=1))
tcp LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* users:(("host-web",pid=14,fd=1))
tcp LISTEN 0 128 [::1]:22 [::]:* users:(("sshd",pid=15,fd=1))`
	bindings := []publishedPortBinding{{53, "TCP", "0.0.0.0", "dns-stream"}, {53, "UDP", "0.0.0.0", "dns-datagram"}, {8080, "TCP", "192.0.2.1", "web-a"}, {8080, "TCP", "192.0.2.2", "web-b"}}
	rows := parseOpenPorts(output, bindings, true)
	expected := []string{"dns-stream", "dns-datagram", "web-a", "web-b", "Host", "Host"}
	if len(rows) != len(expected) {
		t.Fatal(rows)
	}
	for i, row := range rows {
		if row.Container != expected[i] {
			t.Fatalf("row %d: %+v", i, row)
		}
	}
	if rows[0].Process != "dns-tcp" || rows[5].Process != "sshd" || rows[5].Address != "[::1]" {
		t.Fatal("parser lost process/address", rows)
	}
	for _, row := range parseOpenPorts(output, bindings, false) {
		if row.Container != "—" {
			t.Fatal("failed Docker query became known host", row)
		}
	}
}
func TestListeningPortsDoNotGuessAmbiguousWildcardOwner(t *testing.T) {
	bindings := []publishedPortBinding{{8080, "TCP", "0.0.0.0", "ipv4-app"}, {8080, "TCP", "::", "ipv6-app"}}
	rows := parseOpenPorts("tcp LISTEN 0 100 *:8080 *:*", bindings, true)
	if len(rows) != 1 || rows[0].Container != "—" || rows[0].Process != "—" {
		t.Fatal(rows)
	}
	if rows := parseOpenPorts("Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port", nil, true); len(rows) != 0 {
		t.Fatal(rows)
	}
}
