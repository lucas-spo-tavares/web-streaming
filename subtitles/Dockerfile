FROM public.ecr.aws/lambda/python:3.13 AS build
RUN dnf install -y gcc make tar xz openssl-devel zlib-devel pkgconf-pkg-config binutils zip && dnf clean all
WORKDIR /build
COPY ffmpeg.tar.xz /build/ffmpeg.tar.xz
RUN tar -xf ffmpeg.tar.xz --strip-components=1 && \
    ./configure --prefix=/opt --disable-everything --disable-autodetect --disable-doc \
      --disable-debug --disable-x86asm --disable-static --enable-shared --enable-small --enable-version3 \
      --enable-ffmpeg --enable-ffprobe --enable-network --enable-openssl --enable-zlib \
      --enable-protocol=file,http,https,tcp,tls,crypto,udp \
      --enable-demuxer=matroska,mov,avi,mpegts,mpegvideo,mpegps,ogg \
      --enable-muxer=srt,webvtt \
      --enable-decoder=subrip,ass,ssa,webvtt,mov_text,text \
      --enable-encoder=subrip,webvtt && \
    make -j2 && make install && \
    mkdir -p /opt/licenses/ffmpeg && cp COPYING.LGPLv3 LICENSE.md /opt/licenses/ffmpeg/ && \
    LD_LIBRARY_PATH=/opt/lib ldd /opt/bin/ffmpeg /opt/bin/ffprobe /opt/lib/*.so | \
      awk '/=> \/(lib|usr)/ {print $3}' | sort -u | \
      while read lib; do case "$lib" in */libc.so*|*/libm.so*|*/libpthread.so*|*/libdl.so*|*/librt.so*) ;; *) cp -nL "$lib" /opt/lib/ ;; esac; done && \
    cd /opt && zip -qr /build/ffmpeg-layer.zip bin lib licenses

FROM public.ecr.aws/lambda/python:3.13
COPY --from=build /opt/bin /opt/bin
COPY --from=build /opt/lib /opt/lib
COPY --from=build /opt/licenses /opt/licenses
COPY --from=build /build/ffmpeg-layer.zip /artifacts/ffmpeg-layer.zip
COPY handler.py /var/task/handler.py
ENV PATH="/opt/bin:${PATH}" LD_LIBRARY_PATH="/opt/lib:${LD_LIBRARY_PATH}"
CMD ["handler.handler"]
