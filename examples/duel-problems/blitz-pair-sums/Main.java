import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] t = tokens();
        int n = Integer.parseInt(t[0]);
        long target = Long.parseLong(t[1]), pairs = 0;
        HashMap<Long, Integer> seen = new HashMap<>();
        for (int i = 0; i < n; ++i) {
            long x = Long.parseLong(t[2 + i]);
            pairs += seen.getOrDefault(target - x, 0);
            seen.merge(x, 1, Integer::sum);
        }
        System.out.println(pairs);
    }
}
