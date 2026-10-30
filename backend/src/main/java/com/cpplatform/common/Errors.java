package com.cpplatform.common;

import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;

@RestControllerAdvice
public class Errors {
    private static final org.slf4j.Logger log=org.slf4j.LoggerFactory.getLogger(Errors.class);
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<?> rejected(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error", error.getReason() == null ? "Request rejected" : error.getReason()));
    }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<?> constraint(DataIntegrityViolationException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error","Conflicting data or invalid resource state"));
    }
    @ExceptionHandler(DataAccessException.class)
    ResponseEntity<?> database(DataAccessException error) {
        log.error("Database operation failed",error);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error","The server could not complete this action; nothing was changed. Try again, and check the server log if it continues."));
    }
    @ExceptionHandler({IllegalArgumentException.class, ClassCastException.class})
    ResponseEntity<?> malformed(RuntimeException error) {
        return ResponseEntity.badRequest().body(Map.of("error","Invalid request"));
    }
}
