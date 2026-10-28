package com.cpplatform.identity;

import org.springframework.stereotype.Component;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.transaction.event.*;
import org.springframework.scheduling.annotation.Async;
import org.slf4j.*;

@Component
public class ResetMail {
    public record Request(String email,String token) {}
    private static final Logger LOG=LoggerFactory.getLogger(ResetMail.class);
    private final ObjectProvider<JavaMailSender> sender;
    private final String from,url;
    public ResetMail(ObjectProvider<JavaMailSender> sender,@Value("${cp.mail.from:noreply@localhost}") String from,
                     @Value("${cp.public-url:http://localhost:3000}") String url) { this.sender=sender;this.from=from;this.url=url; }
    @Async
    @TransactionalEventListener(phase=TransactionPhase.AFTER_COMMIT)
    public void send(Request request) {
        JavaMailSender mail=sender.getIfAvailable();
        if(mail==null) { LOG.warn("Password reset mail unavailable: configure SMTP"); return; }
        try {
            SimpleMailMessage message=new SimpleMailMessage();message.setFrom(from);message.setTo(request.email());
            message.setSubject("Reset your CP platform password");
            message.setText("Reset your password within 30 minutes: "+url+"/reset-password?token="+request.token());
            mail.send(message);
        } catch(Exception error) { LOG.warn("Password reset email delivery failed"); }
    }
}
