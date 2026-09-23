FROM coturn/coturn:4.17.2-r0
COPY remote/coturn/turnserver.conf /etc/coturn/dani-dex.conf
COPY remote/coturn/entrypoint.sh /usr/local/bin/dani-dex-coturn
ENTRYPOINT ["/usr/local/bin/dani-dex-coturn"]
