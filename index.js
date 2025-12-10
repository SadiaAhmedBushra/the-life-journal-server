require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const app = express();
const { MongoClient, ServerApiVersion } = require("mongodb");

const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.lpz93gz.mongodb.net/?appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("the-life-journal-db");
    const lessonCollection = db.collection("lessons");
    const userCollection = db.collection("users");

    // lesson api
    app.get("/lessons", async (req, res) => {
      try {
        const query = {};
        const { email } = req.query;
        console.log("QUERY EMAIL:", email);

        if (email) {
          query.email = email;
        }

        const options = { sort: { createdAt: -1 } };

        // all lessons
        const allLessons = await lessonCollection.find({}).toArray();
        console.log("All Lessons:", allLessons);

        // filtered lessons
        const result = await lessonCollection.find(query, options).toArray();
        console.log("Lessons Filtered by User Email:", result);

        res.send(result);
      } catch (error) {
        console.error("Error fetching lessons:", error);
        res.status(500).send({ error: "Failed to fetch lessons" });
      }
    });

    // post lesson
    app.post("/lessons", async (req, res) => {
      const lesson = req.body;
      console.log(lesson);
      const result = await lessonCollection.insertOne(lesson);
      res.send(result);
    });

    // delete lesson
    app.delete("/lessons/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await lessonCollection.deleteOne(query);
      res.send(result);
    });

    //  save or update user
    app.post("/users", async (req, res) => {
      const userData = req.body;

      userData.createdAt = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = "freeUser";

      const userQuery = { email: userData.email };

      const alreadyExists = await userCollection.findOne(userQuery);

      if (alreadyExists) {
        const result = await userCollection.updateOne(userQuery, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }
      const result = await userCollection.insertOne(userData);
      res.send(result);

      console.log(userData);
    });

    // user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role });
    });

    // payment apis
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);
      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        mode: "payment",
        metadata: {
          customer: paymentInfo?.email,
        },

        success_url: `${process.env.SITE_DOMAIN}/payment/success`,
        cancel_url: `${process.env.SITE_DOMAIN}/payment/cancelled`,
      });
      res.send({ url: session.url });
    });

    app.post(
      "/webhook",
      express.raw({ type: "application/json" }),
      (request, response) => {
        const sig = request.headers["stripe-signature"];
        let event;

        try {
          event = stripe.webhooks.constructEvent(
            request.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
          );
        } catch (err) {
          return response.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const customerEmail = session.metadata.customer;

          userCollection.updateOne(
            { email: customerEmail },
            { $set: { isPremium: true, role: "premiumUser" } }
          );
        }

        response.send();
      }
    );

    app.get("/lessons/:id", async (req, res) => {
      const id = req.params.id;

      try {
        const result = await lessonCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!result) {
          return res.status(404).send({ message: "Lesson not found" });
        }

        res.send(result);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Invalid ID format" });
      }
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Welcome to The Life Journal!");
});

app.listen(port, () => {
  console.log(`The Life Journal is listening on port ${port}`);
});