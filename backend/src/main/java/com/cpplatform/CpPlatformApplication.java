package com.cpplatform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

@org.springframework.scheduling.annotation.EnableScheduling
@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class CpPlatformApplication {
    public static void main(String[] args) {
        SpringApplication.run(CpPlatformApplication.class, args);
    }
}
