package com.cpplatform.config;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.core.annotation.Order;
import org.springframework.core.Ordered;
import java.io.*;

/** Bound JSON before deserialization, including chunked requests. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestSizeFilter extends org.springframework.web.filter.OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)
            throws IOException,ServletException {
        if(!java.util.Set.of("POST","PUT","PATCH").contains(request.getMethod())){chain.doFilter(request,response);return;}
        int max=request.getRequestURI().startsWith("/api/lab/")?20*1024*1024:1024*1024;
        if(request.getContentLengthLong()>max){response.sendError(413);return;}
        byte[] bytes=request.getInputStream().readNBytes(max+1);
        if(bytes.length>max){response.sendError(413);return;}
        HttpServletRequestWrapper wrapped=new HttpServletRequestWrapper(request) {
            @Override public ServletInputStream getInputStream() {
                ByteArrayInputStream input=new ByteArrayInputStream(bytes);
                return new ServletInputStream() {
                    public int read(){return input.read();}
                    public int read(byte[] b,int off,int len){return input.read(b,off,len);}
                    public boolean isFinished(){return input.available()==0;}
                    public boolean isReady(){return true;}
                    public void setReadListener(ReadListener listener){throw new UnsupportedOperationException();}
                };
            }
            @Override public BufferedReader getReader(){return new BufferedReader(new InputStreamReader(getInputStream(),java.nio.charset.StandardCharsets.UTF_8));}
        };
        chain.doFilter(wrapped,response);
    }
}
