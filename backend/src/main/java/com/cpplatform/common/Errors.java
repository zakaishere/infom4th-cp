package com.cpplatform.common;

import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.Map;

@RestControllerAdvice
public class Errors {
    @ExceptionHandler(ResponseStatusException.class)
    ResponseEntity<?> rejected(ResponseStatusException error) {
        return ResponseEntity.status(error.getStatusCode()).body(Map.of("error", error.getReason() == null ? "Request rejected" : error.getReason()));
    }
    @ExceptionHandler(DataIntegrityViolationException.class)
    ResponseEntity<?> constraint(DataIntegrityViolationException error) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error","Conflicting data or invalid resource state"));
    }
    @ExceptionHandler({IllegalArgumentException.class, ClassCastException.class})
    ResponseEntity<?> malformed(RuntimeException error) {
        return ResponseEntity.badRequest().body(Map.of("error","Invalid request"));
    }
}
