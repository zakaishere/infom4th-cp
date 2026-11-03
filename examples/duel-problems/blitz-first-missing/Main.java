import java.io.*;
import java.util.*;

public class Main {
    static String[] tokens() throws IOException { return new String(System.in.readAllBytes()).trim().split("\\s+"); }
    public static void main(String[] args) throws IOException {
        String[] t = tokens();
        int n = Integer.parseInt(t[0]);
        boolean[] seen = new boolean[n + 2];
        for (int i = 1; i <= n; ++i) {
            long x = Long.parseLong(t[i]);
            if (x >= 1 && x <= n) seen[(int) x] = true;
        }
        int answer = 1;
        while (seen[answer]) ++answer;
        System.out.println(answer);
    }
}
