import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] t = tokens();
        int n = Integer.parseInt(t[0]);
        long first = Long.MIN_VALUE, second = Long.MIN_VALUE;
        for (int i = 1; i <= n; ++i) {
            long x = Long.parseLong(t[i]);
            if (x > first) { second = first; first = x; }
            else if (x < first && x > second) second = x;
        }
        System.out.println(second == Long.MIN_VALUE ? "NONE" : String.valueOf(second));
    }
}
