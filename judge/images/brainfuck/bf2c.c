/* Translates a Brainfuck program into C, so contestant programs run at compiled speed.
 * Cells are 8-bit and wrap; the tape has 1 MiB on each side of the start cell; reading
 * past the end of input stores 0. Characters other than the eight commands are comments.
 * Usage: bf2c program.bf output.c  (exit code 1 with a message on unbalanced brackets) */
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char **argv) {
    if (argc != 3) { fprintf(stderr, "usage: bf2c program.bf output.c\n"); return 2; }
    FILE *in = fopen(argv[1], "rb");
    if (!in) { perror(argv[1]); return 2; }
    size_t size = 0, capacity = 1 << 16;
    char *code = malloc(capacity);
    int c;
    while ((c = fgetc(in)) != EOF) {
        if (c != '+' && c != '-' && c != '<' && c != '>' && c != '.' && c != ',' && c != '[' && c != ']') continue;
        if (size == capacity) code = realloc(code, capacity *= 2);
        code[size++] = (char)c;
    }
    fclose(in);
    long depth = 0;
    for (size_t i = 0; i < size; i++) {
        if (code[i] == '[') depth++;
        if (code[i] == ']' && --depth < 0) { fprintf(stderr, "error: unmatched ']' at command %zu\n", i + 1); return 1; }
    }
    if (depth) { fprintf(stderr, "error: %ld unmatched '['\n", depth); return 1; }
    FILE *out = fopen(argv[2], "w");
    if (!out) { perror(argv[2]); return 2; }
    fputs("#include <stdio.h>\nstatic unsigned char tape[2 << 20];\n"
          "int main(void) {\n    unsigned char *p = tape + (1 << 20);\n    int c;\n", out);
    for (size_t i = 0; i < size; i++) {
        char op = code[i];
        if ((op == '+' || op == '-' || op == '<' || op == '>')) {
            long count = 0;
            /* Runs of the same pair of commands fold into one statement. */
            char up = (op == '+' || op == '-') ? '+' : '>', down = up == '+' ? '-' : '<';
            while (i < size && (code[i] == up || code[i] == down)) count += code[i++] == up ? 1 : -1;
            i--;
            if (count && up == '+') fprintf(out, "    *p += %ld;\n", count);
            if (count && up == '>') fprintf(out, "    p += %ld;\n", count);
        } else if (op == '[' && i + 2 < size && (code[i + 1] == '-' || code[i + 1] == '+') && code[i + 2] == ']') {
            fputs("    *p = 0;\n", out);
            i += 2;
        } else if (op == '[') fputs("    while (*p) {\n", out);
        else if (op == ']') fputs("    }\n", out);
        else if (op == '.') fputs("    putchar(*p);\n", out);
        else if (op == ',') fputs("    c = getchar(); *p = c == EOF ? 0 : (unsigned char)c;\n", out);
    }
    fputs("    return 0;\n}\n", out);
    return fclose(out) ? 2 : 0;
}
