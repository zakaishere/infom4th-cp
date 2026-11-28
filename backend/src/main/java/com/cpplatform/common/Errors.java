package com.cpplatform.common;

import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MissingRequestHeaderException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
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
    @ExceptionHandler({IllegalArgumentException.class, ClassCastException.class, HttpMessageNotReadableException.class, MethodArgumentTypeMismatchException.class, MissingRequestHeaderException.class})
    ResponseEntity<?> malformed(Exception error) {
        return ResponseEntity.badRequest().body(Map.of("error","Invalid request"));
    }
    @ExceptionHandler(IllegalStateException.class)
    ResponseEntity<?> illegalState(IllegalStateException error) {
        log.error("Unexpected server state",error);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error","The server could not complete this action; try again later."));
    }
}
