import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] t = tokens();
        int n = Integer.parseInt(t[0]);
        int k = (int) (Long.parseLong(t[1]) % n);
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < n; ++i) out.append(t[2 + (i - k + n) % n]).append(i + 1 == n ? "\n" : " ");
        System.out.print(out);
    }
}
