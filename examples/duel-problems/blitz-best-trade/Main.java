import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] t = tokens();
        int n = Integer.parseInt(t[0]);
        long low = Long.MAX_VALUE, best = 0;
        for (int i = 1; i <= n; ++i) {
            long p = Long.parseLong(t[i]);
            best = Math.max(best, p - low);
            low = Math.min(low, p);
        }
        System.out.println(best);
    }
}
