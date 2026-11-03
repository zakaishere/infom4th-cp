import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] w = tokens();
        StringBuilder out = new StringBuilder();
        for (int i = w.length - 1; i >= 0; --i) out.append(w[i]).append(i == 0 ? "\n" : " ");
        System.out.print(out);
    }
}
